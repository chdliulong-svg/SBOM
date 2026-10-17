# services/ai_service.py
"""
Service BOM - 离线大模型智能语义推断与物料信息提取服务
基于本地部署的 Qwen2.5 工业指令模型，支持无网环境下对任意顺序、非标格式的物料描述进行实体推断。
"""

import os
import sys
import re
import json
import time
import threading
from services.logging_setup import get_logger

logger = get_logger('sbom.ai')

# 模型本地缓存快照目录
LOCAL_MODEL_DIR = os.path.expanduser(r"~/.cache/modelscope/models/Qwen--Qwen2.5-0.5B-Instruct/snapshots/master")

# 全局单例模型与分词器（延迟初始化 + 线程安全）
_model_lock = threading.Lock()
_tokenizer = None
_model = None
_model_loaded = False
_model_load_error = None


def is_local_model_available():
    """检查本地模型权重文件是否完整存在。"""
    if not os.path.isdir(LOCAL_MODEL_DIR):
        return False
    required_files = ['config.json', 'model.safetensors', 'tokenizer.json']
    return all(os.path.isfile(os.path.join(LOCAL_MODEL_DIR, f)) for f in required_files)


def get_or_load_model():
    """
    单例获取加载的本地模型。
    首次调用时载入内存，后续请求直接复用内存中的模型，无需重复载入。
    """
    global _tokenizer, _model, _model_loaded, _model_load_error
    if _model_loaded:
        return _tokenizer, _model

    with _model_lock:
        if _model_loaded:
            return _tokenizer, _model

        if not is_local_model_available():
            _model_load_error = f"本地模型文件不存在: {LOCAL_MODEL_DIR}"
            return None, None

        try:
            import torch
            from transformers import AutoModelForCausalLM, AutoTokenizer

            t0 = time.time()
            _tokenizer = AutoTokenizer.from_pretrained(LOCAL_MODEL_DIR)
            target_dtype = torch.bfloat16 if hasattr(torch, 'bfloat16') else torch.float32
            _model = AutoModelForCausalLM.from_pretrained(
                LOCAL_MODEL_DIR,
                torch_dtype=target_dtype,
                low_cpu_mem_usage=True
            )
            _model.eval()
            _model_loaded = True
            _model_load_error = None
            logger.info(f"本地离线大模型成功载入内存，耗时: {time.time() - t0:.2f}s (dtype={target_dtype})")
            return _tokenizer, _model
        except Exception as e:
            _model_load_error = str(e)
            logger.error(f"本地大模型加载失败: {e}")
            return None, None


SYSTEM_PROMPT = """你是一个专业的变桨系统工程物料(Service BOM)语义推断专家。
工程人员输入的物料描述可能具有任意词序、下划线、空格等连接形式。
请从物料描述中精准推断并提取以下三个核心字段，不要受词语先后顺序的影响：
1. name: 具体的零部件/元器件实体名称（如“插座”、“维护开关”、“绑线支架”；过滤“备件_”、“变桨备件_”等通用分类前缀）。
2. spec_model: 零件的规格型号、订货号或图纸代号（如 EA9X310_2P+E/10A、3LD2704-0TK51、D8-07-02-Q00632-00）。注意：规格型号应仅为零件自身的参数编码，切勿包含供应商/品牌名称！
3. manufacturer: 供应商/制造商品牌（如 施耐德、西门子、SSB、诺雅克、ABB等，国际品牌自动转换为中文规范名）。

【示例1】
输入：变桨备件_传感器撞块_DBJ00.004.1386.01_电力电子
输出：{"name": "传感器撞块", "spec_model": "DBJ00.004.1386.01", "manufacturer": "电力电子"}

【示例2】
输入：支架_66-31-02-Q00448-00_限位开关支架_X3_SSB
输出：{"name": "限位开关支架", "spec_model": "66-31-02-Q00448-00", "manufacturer": "SSB"}

【示例3】
输入：维护开关_3LD2704-0TK51_Siemens
输出：{"name": "维护开关", "spec_model": "3LD2704-0TK51", "manufacturer": "西门子"}

必须严格输出 JSON 格式，不要输出任何解释说明。"""


def clean_json_output(raw_text: str) -> dict:
    """提取大模型输出中的 JSON 字典并清洗。"""
    raw_text = raw_text.strip()
    match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', raw_text, re.DOTALL)
    if match:
        json_str = match.group(1)
    else:
        match_obj = re.search(r'(\{.*?\})', raw_text, re.DOTALL)
        json_str = match_obj.group(1) if match_obj else raw_text

    try:
        data = json.loads(json_str)
        name = str(data.get("name") or "").strip()
        spec = str(data.get("spec_model") or "").strip()
        mfr = str(data.get("manufacturer") or "").strip()
        notes = str(data.get("notes") or "").strip()

        # 工业常用国际品牌标准中文名对齐（对齐用户历史数据库录入标准）
        brand_map = {
            'SIEMENS': '西门子',
            'SIEMENSE': '西门子',
            'SCHNEIDER': '施耐德',
            'MOELLER': '伊顿',
            'EATON': '伊顿',
            'WEIDMULLER': '魏德米勒',
            'WEI': '魏德米勒',
            'WAGO': '万可',
            'PHOENIX': '菲尼克斯',
            'OMRON': '欧姆龙',
            'SICK': '西克'
        }
        upper_mfr = mfr.upper()
        normalized_mfr = mfr
        for k, v in brand_map.items():
            if k in upper_mfr:
                normalized_mfr = v
                break

        # 进一步清洗：防止在型号头部或尾部粘连供应商名称（如 Schneider_EA9X310 或 3LD2704-0TK51_Siemens）
        brand_tokens = [mfr, normalized_mfr]
        for k, v in brand_map.items():
            if k in upper_mfr:
                brand_tokens.extend([k, v])
                brand_tokens.extend(k.split())

        for b in set(brand_tokens):
            if not b:
                continue
            b_clean = b.strip()
            for sep in ['_', '-', ' ']:
                # 1. 检查头部前缀 (如 Schneider_EA9X310 -> EA9X310)
                prefix = f"{b_clean}{sep}".lower()
                if spec.lower().startswith(prefix):
                    spec = spec[len(prefix):].strip('_ -')
                # 2. 检查尾部后缀 (如 3LD2704-0TK51_Siemens -> 3LD2704-0TK51)
                suffix = f"{sep}{b_clean}".lower()
                if spec.lower().endswith(suffix):
                    spec = spec[:-len(suffix)].strip('_ -')

        return {
            "name": name,
            "spec_model": spec,
            "manufacturer": normalized_mfr
        }
    except Exception:
        return {}


def parse_with_local_llm(description: str) -> dict:
    """使用本地离线 Qwen 模型进行语义推断。"""
    tokenizer, model = get_or_load_model()
    if not model or not tokenizer:
        raise RuntimeError(f"本地模型未就绪: {_model_load_error}")

    import torch

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": f"请提取该物料描述：{description}"}
    ]
    prompt_text = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    inputs = tokenizer([prompt_text], return_tensors="pt")

    t0 = time.time()
    with torch.no_grad():
        outputs = model.generate(
            **inputs,
            max_new_tokens=128,
            do_sample=False
        )
    cost = time.time() - t0

    generated_ids = [
        output_ids[len(input_ids):] for input_ids, output_ids in zip(inputs.input_ids, outputs)
    ]
    response = tokenizer.batch_decode(generated_ids, skip_special_tokens=True)[0]
    result = clean_json_output(response)
    if not result:
        raise ValueError(f"模型输出无法解析为有效 JSON: {response}")

    result["cost_seconds"] = round(cost, 2)
    result["engine"] = "local_qwen_offline"
    return result


def parse_with_rule_fallback(description: str) -> dict:
    """启发式后备解析引擎（当大模型发生异常时无缝兜底）。"""
    desc = (description or "").strip()
    parts = [p.strip() for p in re.split(r'[_/\s]+', desc) if p.strip()]

    known_mfrs = {
        'SSB', 'ABB', 'SKF', 'LINCOLN', 'SIEMENS', 'SCHNEIDER', 'MOELLER',
        'WEIDMULLER', 'WAGO', 'PHOENIX', 'EATON', 'OMRON', 'SICK',
        '电力电子', '阳光电源', '西门子', '施耐德', '伊顿', '魏德米勒',
        '诺雅克', '宏发', '友容', '中普', '及安盾', '中熔', '阿尔法', '百能堡', '西岱尔'
    }

    mfr = ""
    for p in parts:
        if p.upper() in {m.upper() for m in known_mfrs} or any(km in p for km in known_mfrs):
            mfr = p
            break

    code_pat = re.compile(r'^[A-Za-z0-9]+[-.][A-Za-z0-9\-.]+$')
    model_cands = [p for p in parts if code_pat.match(p)]

    name_cands = [p for p in parts if p != mfr and p not in model_cands and p not in {'备件', '变桨备件', '变桨系统'}]

    name = max(name_cands, key=len) if name_cands else ""
    spec = model_cands[0] if model_cands else ""

    return {
        "name": name,
        "spec_model": spec,
        "manufacturer": mfr,
        "notes": "",
        "cost_seconds": 0.01,
        "engine": "rule_heuristic_fallback"
    }


CONFIG_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'ai_config.json')

def get_ai_config():
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
    return {}

def parse_with_cloud_llm(description: str, cfg: dict) -> dict:
    """调用云端大模型 API（如智谱 GLM-4-Flash、硅基流动等 OpenAI 兼容格式）。"""
    import urllib.request

    base_url = (cfg.get("base_url") or "").strip().rstrip('/')
    api_key = (cfg.get("api_key") or "").strip()
    model = (cfg.get("model") or "glm-4-flash").strip()
    timeout = cfg.get("timeout", 10)

    if not base_url or not api_key:
        raise ValueError("缺少云端 API 配置信息")

    url = f"{base_url}/chat/completions"
    headers = {
        'Authorization': f'Bearer {api_key}',
        'Content-Type': 'application/json'
    }
    data = {
        'model': model,
        'messages': [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"请提取该物料描述：{description}"}
        ],
        'temperature': 0.1
    }

    t0 = time.time()
    req = urllib.request.Request(url, data=json.dumps(data).encode('utf-8'), headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        res = json.loads(resp.read().decode('utf-8'))
        cost = time.time() - t0
        raw_content = res['choices'][0]['message']['content']
        result = clean_json_output(raw_content)
        if not result:
            raise ValueError(f"云端模型输出无法解析为 JSON: {raw_content}")
        result["cost_seconds"] = round(cost, 2)
        result["engine"] = f"cloud_{model}"
        return result

def extract_material_semantics(description: str) -> dict:
    """
    统一入口：
    1. 优先调用免费高速云端大模型（如智谱 GLM-4-Flash，~1.5秒极速响应，零本地资源占用）；
    2. 若断网或未配置云端 Key，自动平滑降级至本地离线大模型（Qwen2.5 本地 CPU 运行）；
    3. 若极端异常，自动降级至启发规则兜底。
    """
    desc = (description or "").strip()
    if not desc:
        return {
            "success": False,
            "error": "物料描述不能为空",
            "data": {"name": "", "spec_model": "", "manufacturer": "", "notes": ""}
        }

    # 1. 优先尝试云端高速大模型 (如配置了有效的 API Key)
    cfg = get_ai_config()
    if cfg.get("api_key"):
        try:
            res = parse_with_cloud_llm(desc, cfg)
            if res.get("name") or res.get("spec_model") or res.get("manufacturer"):
                return {
                    "success": True,
                    "engine": "cloud_llm",
                    "data": res
                }
        except Exception as e:
            print(f"[AI Service] 云端大模型调用失败，自动降级至本地离线模型: {e}")

    # 2. 降级尝试本地离线大模型推理
    if is_local_model_available():
        try:
            res = parse_with_local_llm(desc)
            if res.get("name") or res.get("spec_model") or res.get("manufacturer"):
                return {
                    "success": True,
                    "engine": "local_llm",
                    "data": res
                }
        except Exception as e:
            print(f"[AI Service] 本地大模型推断异常，降级至启发规则: {e}")

    # 3. 终极兜底
    fb = parse_with_rule_fallback(desc)
    return {
        "success": True,
        "engine": "heuristic_fallback",
        "data": fb
    }
