# deploy/pack_for_linux.py
"""
打包变桨系统Service BOM为 Linux 生产部署归档包 (service_bom_deploy.tar.gz)
自动将文本与脚本文件的换行符统一规范化为 Unix (LF)，排除无关环境与临时文件。
"""
import os
import tarfile
import io
import time

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT_TAR = os.path.join(PROJECT_ROOT, "service_bom_deploy.tar.gz")

EXCLUDE_DIRS = {
    '.git', '.venv', 'venv', 'env', '__pycache__', '.pytest_cache',
    '.vscode', '.idea', 'scratch', 'backups', 'exports', 'uploads',
    '.workbuddy-ai'
}

EXCLUDE_EXTS = {
    '.pyc', '.pyo', '.pyd', '.tmp', '.log', '.bat', '.vbs', '.pptx'
}

LF_EXTS = {'.sh', '.service', '.conf', '.ini', '.py', '.txt', '.md', '.json', '.html', '.css', '.js'}


def should_exclude(rel_path):
    parts = rel_path.replace('\\', '/').split('/')
    for p in parts:
        if p in EXCLUDE_DIRS:
            return True
    _, ext = os.path.splitext(rel_path)
    if ext.lower() in EXCLUDE_EXTS:
        return True
    if rel_path.endswith('.tar.gz') or rel_path.endswith('.zip'):
        return True
    return False


def main():
    t0 = time.time()
    print("=====================================================")
    print(f"  变桨系统Service BOM - Linux 离线部署包生成器")
    print(f"  项目根目录: {PROJECT_ROOT}")
    print(f"  目标输出:   {OUTPUT_TAR}")
    print("=====================================================")

    file_count = 0
    total_bytes = 0

    # 使用快速 gzip 压缩
    with tarfile.open(OUTPUT_TAR, "w:gz", compresslevel=3) as tar:
        for root, dirs, files in os.walk(PROJECT_ROOT):
            dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]

            for file in sorted(files):
                abs_path = os.path.join(root, file)
                rel_path = os.path.relpath(abs_path, PROJECT_ROOT).replace('\\', '/')

                if should_exclude(rel_path):
                    continue

                _, ext = os.path.splitext(file)
                tar_path = f"service-bom/{rel_path}"

                # 文本与脚本文件：统一转为 Unix LF 换行符
                if ext.lower() in LF_EXTS:
                    try:
                        with open(abs_path, 'rb') as f:
                            raw = f.read()
                        clean_data = raw.replace(b'\r\n', b'\n')
                        ti = tarfile.TarInfo(name=tar_path)
                        ti.size = len(clean_data)
                        ti.mtime = int(os.path.getmtime(abs_path))
                        ti.mode = 0o755 if ext.lower() in {'.sh'} else 0o644
                        tar.addfile(ti, io.BytesIO(clean_data))
                        file_count += 1
                        total_bytes += len(clean_data)
                        continue
                    except Exception as e:
                        print(f"  [警告] 处理 {rel_path} 异常: {e}")

                # 二进制文件直接写入
                ti = tar.gettarinfo(abs_path, arcname=tar_path)
                if ext.lower() in {'.sh'}:
                    ti.mode = 0o755
                with open(abs_path, 'rb') as f:
                    tar.addfile(ti, f)
                file_count += 1
                total_bytes += os.path.getsize(abs_path)

    elapsed = time.time() - t0
    size_mb = os.path.getsize(OUTPUT_TAR) / (1024 * 1024)
    raw_mb = total_bytes / (1024 * 1024)

    print("=====================================================")
    print(f"  [成功] 打包完成！耗时: {elapsed:.1f} 秒")
    print(f"  打包文件数量: {file_count} 个")
    print(f"  原始文件体积: {raw_mb:.2f} MB")
    print(f"  压缩包体积:   {size_mb:.2f} MB")
    print(f"  部署包路径:   {OUTPUT_TAR}")
    print("=====================================================")


if __name__ == '__main__':
    main()
