#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
============================================================
 zxxk-math-paper-download · extract_zips.py
 学科网试卷 ZIP 解压脚本（GBK 文件名还原）

 Designed by TiantianYe
 GitHub: https://github.com/TiantianYeTTY/zxxk-math-paper-download
============================================================
"""
# 解压学科网 ZIP（GBK 文件名还原）到同名文件夹
# 用法1: python3 extract_all_zips.py           -> 批量解压所有年级的 zip
# 用法2: python3 extract_all_zips.py --one <zip> <dest>  -> 解压单个（供 batch_download.js 调用）
import zipfile, os, re, sys, glob

BASE = "/Users/tiantianye/Documents/初中数学上半学期期中考试试卷整理/沪教版五四制上海期中卷"

def extract_one(zpath, dest):
    if os.path.exists(dest) and os.listdir(dest):
        print("跳过(已解压):", os.path.basename(zpath)[:50]); os.remove(zpath); return True
    os.makedirs(dest, exist_ok=True)
    z = zipfile.ZipFile(zpath)
    for info in z.infolist():
        if info.is_dir(): continue
        try: fn = info.filename.encode("cp437").decode("gbk")
        except Exception: fn = info.filename
        fn = re.sub(r'[\\/:*?"<>|]', " ", fn).strip()
        if not fn: continue
        with open(os.path.join(dest, fn), "wb") as f:
            f.write(z.read(info))
    z.close()
    os.remove(zpath)
    print("解压完成:", os.path.basename(zpath)[:60])
    return True

if len(sys.argv) >= 4 and sys.argv[1] == "--one":
    try:
        extract_one(sys.argv[2], sys.argv[3])
    except Exception as e:
        print("失败:", str(e)[:100]); sys.exit(1)
    sys.exit(0)

count = 0
for grade in ["六年级", "七年级", "八年级", "九年级"]:
    gdir = os.path.join(BASE, grade)
    for zpath in glob.glob(os.path.join(gdir, "*.zip")):
        name = os.path.basename(zpath)[:-4].strip()
        dest = os.path.join(gdir, re.sub(r'[\\/:*?"<>|]', " ", name)[:70].strip())
        try:
            if extract_one(zpath, dest): count += 1
        except Exception as e:
            print("失败:", name[:50], "->", str(e)[:80])
print("共解压", count, "个 ZIP")

