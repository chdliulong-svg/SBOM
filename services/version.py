# services/version.py
"""
系统版本与 Git 代码构建信息管理服务
负责动态获取当前仓库的 Git commit hash、提交时间、提交说明与版本号，
并在无 Git 环境时平滑回退至预设版本。
"""
import os
import subprocess
import json

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VERSION_JSON_PATH = os.path.join(PROJECT_ROOT, 'version.json')

_CACHED_VERSION = None

DEFAULT_VERSION_TAG = "v2.2.0"


def get_app_version(force_refresh=False):
    """
    获取当前系统版本详情。
    返回字典结构：
    {
        "version": "v2.2.0",
        "commit": "fa9273b",
        "commit_full": "fa9273b...",
        "date": "2026-10-16",
        "message": "feat: ...",
        "display": "v2.2.0 (fa9273b)"
    }
    """
    global _CACHED_VERSION
    if _CACHED_VERSION is not None and not force_refresh:
        return _CACHED_VERSION

    commit = "main"
    commit_full = ""
    commit_date = ""
    commit_msg = ""

    # 1. 尝试从本地 Git 执行命令获取
    try:
        cmd = ['git', 'log', '-1', '--format=%h|%H|%cd|%s', '--date=format:%Y-%m-%d']
        res = subprocess.run(
            cmd,
            cwd=PROJECT_ROOT,
            capture_output=True,
            text=True,
            timeout=1.5,
            check=False
        )
        if res.returncode == 0 and res.stdout.strip():
            parts = res.stdout.strip().split('|', 3)
            commit = parts[0].strip()
            commit_full = parts[1].strip() if len(parts) > 1 else commit
            commit_date = parts[2].strip() if len(parts) > 2 else ""
            commit_msg = parts[3].strip() if len(parts) > 3 else ""
    except Exception:
        pass

    # 2. 若 Git 命令获取失败，尝试读取 version.json 静态预打包文件
    if commit == "main" and os.path.exists(VERSION_JSON_PATH):
        try:
            with open(VERSION_JSON_PATH, 'r', encoding='utf-8') as f:
                data = json.load(f)
                commit = data.get('commit', commit)
                commit_full = data.get('commit_full', commit_full)
                commit_date = data.get('date', commit_date)
                commit_msg = data.get('message', commit_msg)
        except Exception:
            pass

    _CACHED_VERSION = {
        "version": DEFAULT_VERSION_TAG,
        "commit": commit,
        "commit_full": commit_full or commit,
        "date": commit_date,
        "message": commit_msg,
        "display": f"{DEFAULT_VERSION_TAG} ({commit})" if commit and commit != 'main' else DEFAULT_VERSION_TAG
    }
    return _CACHED_VERSION


def save_version_snapshot():
    """在打包前保存版本快照到 version.json，以便离线部署环境也能正确展示 commit"""
    v = get_app_version(force_refresh=True)
    try:
        with open(VERSION_JSON_PATH, 'w', encoding='utf-8') as f:
            json.dump(v, f, ensure_ascii=False, indent=2)
    except Exception:
        pass
    return v
