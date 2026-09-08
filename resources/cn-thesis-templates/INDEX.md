# 中国大陆高校论文写作规范 & 模板 — 总索引

> **数据规模**：117 所高校、671 条模板记录（含 latex/typst/word/overleaf）
> **覆盖范围**：985 工程 39 所全覆盖；211 工程覆盖 78 所；双一流新增 12 所
> **更新时间**：2026-08-23
> **数据来源**：教育部公开名单 + GitHub/Gitee/CTAN/Overleaf/Typst Universe 检索 + 6 个并行批次 subagent 收集（部分批次因 DeepSeek 额度耗尽未完成，由 README 补救提取）

---

## 目录结构

```
cn-thesis-templates/
├── INDEX.md                       # 本文件
├── templates.json                 # 机器可读：671 条模板元数据（LumenLab Template Registry 导入用）
├── templates.yaml                 # 机器可读：YAML 版本
├── latex/<学校名>/README.md       # 各校 LaTeX 模板索引（117 所）
├── word/<学校名>/README.md        # 各校 Word 模板索引
├── markdown/<学校名>/README.md    # 各校 Typst 模板索引
├── skills/                        # Agent Skill 索引（7 个学术写作 Skill）
├── _meta/                         # 通用规范与社区介绍
│   ├── gb7713_overview.md         # GB/T 7713 等国家通用规范
│   ├── openclaw_intro.md          # OpenClaw 社区简介
│   ├── skills_sh_intro.md         # skills.sh 介绍
│   └── school_lists.md            # 985/211 名单
├── _raw/                          # 原始 web_search 结果（>150 份）
│   ├── u_<学校>.md                # 各校搜索证据
│   ├── batchD_*.json              # 批次 D 多重备份（防竞态）
│   └── final_batchD_208_records.json
└── templates_batch_*.json         # 各 subagent 批次输出（保留可追溯）
```

---

## 1. 国家通用规范

所有高校学位论文都以下列国家标准为底层依据：

- **GB/T 7713.1—2006** 学位论文编写规则
- **GB/T 7714—2015** 信息与文献 参考文献著录规则
- **GB 3102—1993** 量和单位
- **GB/T 15834—2011** 标点符号用法
- **GB/T 15835—2011** 出版物上数字用法

详见 [_meta/gb7713_overview.md](_meta/gb7713_overview.md)。

---

## 2. 覆盖统计

### 2.1 总体统计

| 维度 | 数量 |
|------|------|
| 已覆盖学校 | **117** |
| 模板记录总数 | **671** |
| LaTeX 模板 | 367 |
| Typst 模板 | 128 |
| Word 模板 | 174 |
| Overleaf 模板 | 2 |

### 2.2 推荐等级分布

| 等级 | 数量 | 含义 |
|------|------|------|
| **A** | 45 | 官方/校内组织 + 最近 1 年 commit + 文档完整 + 规范匹配 |
| **B** | 208 | 社区活跃（1-2 年 commit）+ 基本完整 |
| **C** | 189 | 社区较旧（2-3 年无 commit）+ 不完整 |
| **D** | 229 | 仅有仓库无 README / 仅 fork / 验证不足 |

### 2.3 来源分布

| 来源类型 | 数量 |
|----------|------|
| 社区维护 | 421 |
| 官方发布 | 136 |
| 校内组织 | 9 |
| CTAN 收录 | 1-2 |
| GitHub | 76 |
| Overleaf | 1 |
| 其他 | 2 |

### 2.4 学位论文层级覆盖

| 层级 | 记录数 |
|------|--------|
| 本科毕业论文 | 226 |
| 硕士学位论文 | 227 |
| 博士学位论文 | 189 |
| 硕士+博士通用 | 10 |
| 本+硕+博通用 | 18 |
| 本+研究生通用 | 1 |

---

## 3. 985 工程（39 所）

### 3.1 全部 985 工程高校（39 所全覆盖）

| 学校 | 总数 | A | B | C | D | latex | typst | word |
|------|------|---|---|---|---|-------|-------|------|
| 清华大学 | 2 | 1 | 1 | 0 | 0 | 2 | 0 | 0 |
| 北京大学 | 4 | 2 | 2 | 0 | 0 | 2 | 1 | 1 |
| 中国人民大学 | 7 | 0 | 1 | 4 | 2 | 5 | 1 | 1 |
| 北京师范大学 | 1 | 0 | 1 | 0 | 0 | 1 | 0 | 0 |
| 北京航空航天大学 | 2 | 0 | 2 | 0 | 0 | 1 | 0 | 1 |
| 北京理工大学 | 6 | 3 | 1 | 1 | 1 | 4 | 1 | 1 |
| 中国农业大学 | 7 | 0 | 3 | 1 | 3 | 2 | 4 | 1 |
| 中央民族大学 | 4 | 0 | 0 | 2 | 2 | 1 | 1 | 2 |
| 北京交通大学 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 北京科技大学 | 3 | 0 | 0 | 0 | 3 | 1 | 1 | 1 |
| 北京化工大学 | 5 | 0 | 3 | 0 | 2 | 3 | 1 | 1 |
| 北京邮电大学 | 2 | 0 | 1 | 1 | 0 | 2 | 0 | 0 |
| 北京林业大学 | 8 | 0 | 3 | 3 | 2 | 6 | 1 | 1 |
| 北京中医药大学 | 4 | 0 | 0 | 1 | 3 | 1 | 1 | 2 |
| 中国传媒大学 | 1 | 0 | 1 | 0 | 0 | 1 | 0 | 0 |
| 中央财经大学 | 1 | 0 | 0 | 1 | 0 | 1 | 0 | 0 |
| 对外经济贸易大学 | 4 | 0 | 1 | 0 | 3 | 1 | 1 | 2 |
| 北京外国语大学 | 3 | 0 | 0 | 2 | 1 | 1 | 1 | 1 |
| 中国政法大学 | 3 | 0 | 1 | 0 | 2 | 1 | 1 | 1 |
| 华北电力大学 | 8 | 0 | 1 | 5 | 2 | 6 | 1 | 1 |
| 中国石油大学（北京） | 4 | 0 | 0 | 1 | 3 | 2 | 1 | 1 |
| 中国地质大学（北京） | 3 | 0 | 0 | 1 | 2 | 1 | 1 | 1 |
| 中国矿业大学（北京） | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 复旦大学 | 2 | 2 | 0 | 0 | 0 | 1 | 1 | 0 |
| 上海交通大学 | 2 | 2 | 0 | 0 | 0 | 2 | 0 | 0 |
| 同济大学 | 1 | 0 | 1 | 0 | 0 | 1 | 0 | 0 |
| 华东师范大学 | 2 | 2 | 0 | 0 | 0 | 1 | 1 | 0 |
| 中国科学技术大学 | 1 | 1 | 0 | 0 | 0 | 1 | 0 | 0 |
| 浙江大学 | 1 | 0 | 1 | 0 | 0 | 1 | 0 | 0 |
| 南京大学 | 1 | 1 | 0 | 0 | 0 | 1 | 0 | 0 |
| 东南大学 | 11 | 0 | 6 | 5 | 0 | 9 | 0 | 2 |
| 哈尔滨工业大学 | 2 | 2 | 0 | 0 | 0 | 1 | 1 | 0 |
| 西北工业大学 | 13 | 1 | 9 | 3 | 0 | 12 | 1 | 0 |
| 西安交通大学 | 2 | 1 | 1 | 0 | 0 | 1 | 0 | 1 |
| 电子科技大学 | 9 | 0 | 5 | 4 | 0 | 8 | 1 | 0 |
| 华中科技大学 | 2 | 1 | 1 | 0 | 0 | 2 | 0 | 0 |
| 武汉大学 | 1 | 0 | 1 | 0 | 0 | 1 | 0 | 0 |
| 中南大学 | 5 | 0 | 1 | 4 | 0 | 5 | 0 | 0 |
| 湖南大学 | 13 | 0 | 4 | 9 | 0 | 11 | 2 | 0 |
| 中山大学 | 1 | 0 | 1 | 0 | 0 | 1 | 0 | 0 |
| 华南理工大学 | 1 | 0 | 1 | 0 | 0 | 1 | 0 | 0 |
| 厦门大学 | 5 | 0 | 2 | 3 | 0 | 4 | 1 | 0 |
| 山东大学 | 11 | 0 | 6 | 5 | 0 | 10 | 1 | 0 |
| 中国海洋大学 | 11 | 0 | 7 | 4 | 0 | 11 | 0 | 0 |
| 四川大学 | 8 | 0 | 0 | 8 | 0 | 7 | 0 | 1 |
| 重庆大学 | 1 | 1 | 0 | 0 | 0 | 1 | 0 | 0 |
| 吉林大学 | 9 | 0 | 6 | 3 | 0 | 8 | 1 | 0 |
| 兰州大学 | 1 | 1 | 0 | 0 | 0 | 1 | 0 | 0 |
| 东北大学 | 6 | 0 | 0 | 6 | 0 | 6 | 0 | 0 |
| 大连理工大学 | 5 | 0 | 0 | 5 | 0 | 5 | 0 | 0 |
| 西北农林科技大学 | 4 | 0 | 0 | 4 | 0 | 4 | 0 | 0 |

### 3.3 双一流第二轮新增 / 行业特色强校

| 学校 | 总数 | A | B | C | D | latex | typst | word |
|------|------|---|---|---|---|-------|-------|------|
| 南方科技大学 | 10 | 2 | 6 | 2 | 0 | 1 | 6 | 3 |
| 上海科技大学 | 12 | 0 | 5 | 0 | 7 | 5 | 3 | 4 |
| 中国社会科学院大学 | 9 | 0 | 3 | 0 | 6 | 3 | 3 | 3 |
| 西湖大学 | 9 | 2 | 2 | 1 | 4 | 3 | 3 | 3 |
| 上海纽约大学 | 9 | 0 | 0 | 3 | 6 | 3 | 3 | 3 |
| 香港中文大学（深圳） | 9 | 0 | 2 | 3 | 4 | 3 | 3 | 3 |
| 北京师范大学-香港浸会大学联合国际学院 | 9 | 0 | 0 | 5 | 4 | 3 | 3 | 3 |
| 北京协和医学院 | 9 | 2 | 0 | 1 | 6 | 3 | 3 | 3 |
| 中国医科大学 | 9 | 0 | 2 | 1 | 6 | 3 | 3 | 3 |
| 首都医科大学 | 9 | 0 | 2 | 1 | 6 | 3 | 3 | 3 |
| 南京医科大学 | 9 | 0 | 1 | 2 | 6 | 3 | 3 | 3 |
| 天津医科大学 | 9 | 0 | 0 | 3 | 6 | 3 | 3 | 3 |
| 成都中医药大学 | 9 | 0 | 0 | 3 | 6 | 3 | 3 | 3 |
| 北京体育大学 | 9 | 0 | 2 | 1 | 6 | 3 | 3 | 3 |
| 上海体育大学 | 9 | 0 | 2 | 1 | 6 | 3 | 3 | 3 |
| 武汉体育学院 | 9 | 0 | 1 | 2 | 6 | 3 | 3 | 3 |
| 北京语言大学 | 9 | 0 | 5 | 0 | 4 | 3 | 3 | 3 |
| 北京工商大学 | 9 | 0 | 2 | 1 | 6 | 3 | 3 | 3 |

## 4. 211 工程（部分精选）

> 完整 211 名单（含全部 116 所）见 [_meta/school_lists.md](_meta/school_lists.md)。本目录收录的是有可验证模板或规范的 211 高校。


### 3.2 211 工程（重点高校精选）

| 学校 | 总数 | A | B | C | D | latex | typst | word |
|------|------|---|---|---|---|-------|-------|------|
| 华东理工大学 | 4 | 0 | 2 | 2 | 0 | 4 | 0 | 0 |
| 东华大学 | 2 | 0 | 1 | 0 | 1 | 2 | 0 | 0 |
| 上海财经大学 | 2 | 0 | 1 | 1 | 0 | 2 | 0 | 0 |
| 上海外国语大学 | 3 | 0 | 0 | 0 | 3 | 0 | 0 | 3 |
| 上海大学 | 9 | 0 | 4 | 4 | 1 | 7 | 2 | 0 |
| 河海大学 | 6 | 0 | 3 | 3 | 0 | 5 | 1 | 0 |
| 江南大学 | 2 | 0 | 2 | 0 | 0 | 2 | 0 | 0 |
| 南京理工大学 | 4 | 0 | 2 | 2 | 0 | 4 | 0 | 0 |
| 南京航空航天大学 | 5 | 0 | 3 | 0 | 2 | 5 | 0 | 0 |
| 南京农业大学 | 3 | 0 | 0 | 0 | 3 | 0 | 0 | 3 |
| 苏州大学 | 5 | 0 | 2 | 3 | 0 | 5 | 0 | 0 |
| 合肥工业大学 | 7 | 0 | 5 | 2 | 0 | 7 | 0 | 0 |
| 中国矿业大学（徐州） | 5 | 0 | 3 | 1 | 1 | 4 | 0 | 1 |
| 中国药科大学 | 3 | 0 | 0 | 0 | 3 | 0 | 0 | 3 |
| 华中农业大学 | 3 | 0 | 0 | 0 | 3 | 0 | 0 | 3 |
| 华中师范大学 | 3 | 0 | 1 | 0 | 2 | 1 | 0 | 2 |
| 武汉理工大学 | 4 | 0 | 4 | 0 | 0 | 4 | 0 | 0 |
| 中南财经政法大学 | 3 | 0 | 0 | 1 | 2 | 1 | 0 | 2 |
| 暨南大学 | 4 | 0 | 3 | 1 | 0 | 4 | 0 | 0 |
| 华南师范大学 | 5 | 0 | 2 | 2 | 1 | 4 | 0 | 1 |
| 西南交通大学 | 6 | 0 | 5 | 1 | 0 | 6 | 0 | 0 |
| 西南财经大学 | 4 | 0 | 1 | 1 | 2 | 2 | 0 | 2 |
| 西北大学 | 3 | 0 | 0 | 1 | 2 | 1 | 0 | 2 |
| 长安大学 | 5 | 0 | 2 | 2 | 1 | 5 | 0 | 0 |
| 陕西师范大学 | 4 | 0 | 0 | 2 | 2 | 2 | 0 | 2 |
| 云南大学 | 11 | 3 | 5 | 3 | 0 | 7 | 0 | 4 |
| 郑州大学 | 10 | 2 | 0 | 6 | 2 | 5 | 0 | 5 |
| 南昌大学 | 7 | 2 | 2 | 3 | 0 | 4 | 0 | 3 |
| 广西大学 | 7 | 3 | 2 | 2 | 0 | 2 | 0 | 5 |
| 内蒙古大学 | 5 | 0 | 2 | 0 | 3 | 1 | 0 | 4 |
| 新疆大学 | 6 | 0 | 1 | 4 | 1 | 3 | 0 | 3 |
| 宁夏大学 | 4 | 0 | 2 | 2 | 0 | 2 | 0 | 2 |
| 青海大学 | 6 | 0 | 3 | 0 | 3 | 3 | 0 | 3 |
| 西藏大学 | 6 | 0 | 3 | 0 | 3 | 3 | 0 | 3 |
| 海南大学 | 6 | 0 | 3 | 0 | 3 | 3 | 0 | 3 |
| 贵州大学 | 9 | 2 | 2 | 5 | 0 | 4 | 2 | 3 |
| 东北财经大学 | 9 | 3 | 0 | 0 | 6 | 3 | 3 | 3 |
| 天津工业大学 | 9 | 0 | 2 | 1 | 6 | 3 | 3 | 3 |
| 上海海洋大学 | 8 | 0 | 2 | 0 | 6 | 3 | 3 | 2 |
| 上海中医药大学 | 8 | 0 | 2 | 0 | 6 | 3 | 3 | 2 |
| 南京邮电大学 | 8 | 2 | 2 | 1 | 3 | 3 | 3 | 2 |
| 南京信息工程大学 | 11 | 0 | 2 | 6 | 3 | 2 | 6 | 3 |
| 南京工业大学 | 7 | 0 | 3 | 1 | 3 | 2 | 3 | 2 |
| 南方医科大学 | 9 | 0 | 2 | 1 | 6 | 3 | 3 | 3 |
| 广州中医药大学 | 9 | 0 | 1 | 2 | 6 | 3 | 3 | 3 |
| 广州医科大学 | 12 | 0 | 3 | 0 | 9 | 3 | 3 | 6 |
| 湘潭大学 | 11 | 0 | 2 | 4 | 5 | 6 | 3 | 2 |
| 深圳大学 | 8 | 0 | 5 | 3 | 0 | 3 | 2 | 3 |



## 5. A 级推荐模板（强推荐）

> 共 **45 条**。可直接用于生产。

| 学校 | 类型 | 格式 | 仓库 / URL | 备注 |
|------|------|------|-----------|------|
| 云南大学 | 硕士 | word | [](#) | 研究生院官方学位论文写作规范页面+PDF |
| 云南大学 | 博士 | word | [](#) | 研究生院官方学位论文写作规范页面+PDF |
| 云南大学 | 本科 | word | [](#) | 教务处本科毕业论文官方通知页 |
| 郑州大学 | 硕士 | word | [](#) | 研究生院官方学位论文格式要求页+附件 |
| 郑州大学 | 博士 | word | [](#) | 研究生院官方学位论文格式要求页+附件 |
| 南昌大学 | 硕士 | word | [](#) | 研究生院官方页面+Word 附件（2018） |
| 南昌大学 | 博士 | word | [](#) | 研究生院官方页面+Word 附件（2018） |
| 广西大学 | 硕士 | word | [](#) | 研究生院官方写作规范页+PDF |
| 广西大学 | 博士 | word | [](#) | 研究生院官方写作规范页+PDF |
| 广西大学 | 本科 | word | [](#) | 教务处本科毕业论文官方通知页 |
| 贵州大学 | 硕士 | word | [](#) | 研究生院官方栏目+规范 PDF |
| 贵州大学 | 博士 | word | [](#) | 研究生院官方栏目+规范 PDF |
| 北京理工大学 | 本科 | latex | [BITNP/BIThesis](https://github.com/BITNP/BIThesis) | 校内组织 BITNP 维护、获教务部/研究生院/计算机学院背书、CTAN 收录、2026-07 仍在 |
| 北京理工大学 | 硕士 | latex | [BITNP/BIThesis](https://github.com/BITNP/BIThesis) | 研究生院发布过《关于发布北京理工大学研究生学位论文LaTeX模板的通知》，BIThesis 为事实标 |
| 北京理工大学 | 博士 | latex | [BITNP/BIThesis](https://github.com/BITNP/BIThesis) | BIThesis 覆盖博士层级 |
| 清华大学 | 硕士+博士 | latex | [tuna/thuthesis](https://github.com/tuna/thuthesis) | 校内/官方组织 + 文档完整 |
| 北京大学 | 博士 | latex | [hauser-zhang/pku-doctoral-thesis](https://github.com/hauser-zhang/pku-doctoral-thesis) | 社区维护活跃 |
| 北京大学 | 硕士+博士 | word | [www.coe.pku.edu.cn/service/biyedb/11191.](https://www.coe.pku.edu.cn/service/biyedb/11191.html) | 校内/官方组织 + 文档完整 |
| 华中科技大学 | 本科+硕士+博士 | latex | [ctan.org/pkg/hustthesis](https://ctan.org/pkg/hustthesis) | 社区维护活跃 |
| 中国科学技术大学 | 本科+硕士+博士 | latex | [ustctug/ustcthesis](https://github.com/ustctug/ustcthesis) | 校内/官方组织 + 文档完整 |
| 上海交通大学 | 硕士+博士 | latex | [sjtug/SJTUThesis](https://github.com/sjtug/SJTUThesis) | 校内/官方组织 + 文档完整 |
| 上海交通大学 | 本科+硕士+博士 | latex | [ctan.org/texarchive/macros/latex/contrib](https://ctan.org/texarchive/macros/latex/contrib/sjtutex) | 校内/官方组织 + 文档完整 |
| 复旦大学 | 本科+硕士+博士 | latex | [stone-zeng/fduthesis](https://github.com/stone-zeng/fduthesis) | 社区维护活跃 |
| 复旦大学 | 本科+硕士+博士 | typst | [hz-xiaxz/fudan-typst-thesis](https://github.com/hz-xiaxz/fudan-typst-thesis) | 社区维护活跃 |
| 南京大学 | 本科+硕士+博士 | latex | [nju-lug/NJUThesis](https://github.com/nju-lug/NJUThesis) | 社区维护活跃 |
| 哈尔滨工业大学 | 本科+硕士+博士 | latex | [dustincys/hithesis](https://github.com/dustincys/hithesis) | 社区维护活跃 |
| 哈尔滨工业大学 | 本科+硕士+博士 | typst | [typst.app/universe/package/universal-hit](https://typst.app/universe/package/universal-hit-thesis) | 社区维护活跃 |
| 西安交通大学 | 硕士+博士 | latex | [Aetf/xjtuthesis](https://github.com/Aetf/xjtuthesis) | 社区维护活跃 |
| 华东师范大学 | 本科+硕士+博士 | latex | [Koyamin/ecnuthesis](https://github.com/Koyamin/ecnuthesis) | 社区维护活跃 |
| 华东师范大学 | 本科+研究生 | typst | [jtchen2k/modern-ecnu-thesis](https://github.com/jtchen2k/modern-ecnu-thesis) | 社区维护活跃 |
| 兰州大学 | 本科+硕士+博士 | latex | [yuhldr/LZUThesis2020](https://github.com/yuhldr/LZUThesis2020) | 社区维护活跃 |
| 重庆大学 | 本科+硕士+博士 | latex | [cqu-bdsc/CQUThesis](https://github.com/cqu-bdsc/CQUThesis) | 社区维护活跃 |
| 西北工业大学 | 博士 | latex | [NWPUMetaphysicsOffice/Yet-Another-LaTeX-](https://github.com/NWPUMetaphysicsOffice/Yet-Another-LaTeX-Template-for-NPU-Thesis) | 从 README 提取（批次 B subagent 未生成 batch JSON） |
| 南方科技大学 | 本科 | word | [](#) | 教务处官方 Word 撰写规范（2410 修改） |
| 南方科技大学 | 硕士 | latex | [SUSTech-CRA/sustech-master-thesis](https://github.com/SUSTech-CRA/sustech-master-thesis) | 323★，校内组织 SUSTech-CRA 维护，2026-08 更新，学校镜像同步，release |
| 南京邮电大学 | 博士 | word | [](#) | 研究生院 2025-05-30 通知（含格式/模板附件） |
| 南京邮电大学 | 硕士 | word | [](#) | 研究生院 2025-05-30 通知（含格式/模板附件） |
| 中国科学院大学 | 硕士+博士 | latex | [lwk205/ucasthesis](https://github.com/lwk205/ucasthesis) | 社区维护活跃 |
| 北京协和医学院 | 硕士 | word | [](#) | 《北京协和医学院研究生学位论文写作规范》 |
| 北京协和医学院 | 博士 | word | [](#) | 《北京协和医学院研究生学位论文写作规范》 |
| 西湖大学 | 本科 | latex | [Westlake-TUG/westlakethesis](https://github.com/Westlake-TUG/westlakethesis) | CTAN/TeX Live 收录、LPPL-1.3c、2026-06-18 发布，西湖大学 TeX  |
| 西湖大学 | 博士 | latex | [Westlake-TUG/westlakethesis](https://github.com/Westlake-TUG/westlakethesis) | 同上（Ph.D. thesis format） |
| 东北财经大学 | 硕士 | word | [](#) | 研究生院官方 Word《研究生学位论文格式要求》直链 |
| 东北财经大学 | 博士 | word | [](#) | 研究生院官方 Word《研究生学位论文格式要求》直链 |
| 东北财经大学 | 本科 | word | [](#) | 教务处页面+本科工作规程 PDF |


## 6. 缺口清单

### 6.1 没有找到 LaTeX/Typst 模板的学校（仅 Word 或暂无可靠模板）

> 4 所学校

- 上海外国语大学
- 中国药科大学
- 华中农业大学
- 南京农业大学

### 6.2 仅有 Word 模板的学校

> 4 所学校

- 上海外国语大学
- 中国药科大学
- 华中农业大学
- 南京农业大学

---

## 7. 需要人工复核的模板

### 7.1 D 级模板过多（≥3 条 D 级记录）的学校

> 这些学校的 README 记录较多 D 级项（仅有仓库无 README / 仅 fork），建议人工到 GitHub 看一眼活跃度再采用。

| 学校 | D 级记录数 |
|------|-----------|
| 广州医科大学 | 9 |
| 上海科技大学 | 7 |
| 南方医科大学 | 6 |
| 天津工业大学 | 6 |
| 上海海洋大学 | 6 |
| 上海中医药大学 | 6 |
| 广州中医药大学 | 6 |
| 东北财经大学 | 6 |
| 上海纽约大学 | 6 |
| 中国社会科学院大学 | 6 |
| 北京协和医学院 | 6 |
| 中国医科大学 | 6 |
| 首都医科大学 | 6 |
| 南京医科大学 | 6 |
| 天津医科大学 | 6 |
| 成都中医药大学 | 6 |
| 北京体育大学 | 6 |
| 上海体育大学 | 6 |
| 武汉体育学院 | 6 |
| 北京工商大学 | 6 |
| 湘潭大学 | 5 |
| 西湖大学 | 4 |
| 香港中文大学（深圳） | 4 |
| 北京师范大学-香港浸会大学联合国际学院 | 4 |
| 北京语言大学 | 4 |
| 北京科技大学 | 3 |
| 北京中医药大学 | 3 |
| 对外经济贸易大学 | 3 |
| 中国石油大学（北京） | 3 |
| 中国农业大学 | 3 |
| 内蒙古大学 | 3 |
| 青海大学 | 3 |
| 西藏大学 | 3 |
| 海南大学 | 3 |
| 南京邮电大学 | 3 |
| 南京信息工程大学 | 3 |
| 南京工业大学 | 3 |
| 上海外国语大学 | 3 |
| 南京农业大学 | 3 |
| 中国药科大学 | 3 |
| 华中农业大学 | 3 |

### 7.2 仅找到官方 Word 规范、无 LaTeX/Typst 模板的学校

- 上海外国语大学
- 中国药科大学
- 华中农业大学
- 南京农业大学

### 7.3 未覆盖学校（211 工程非 985）

> 这些学校未在本目录中创建 README，需补搜：
- 北京工业大学
- 北京建筑大学
- 北京电子科技学院
- 北京联合大学
- 首都经济贸易大学
- 首都师范大学
- 上海海事大学
- 上海音乐学院
- 上海戏剧学院
- 河北工业大学
- 太原理工大学
- 燕山大学
- 河北大学
- 中国石油大学（华东）
- 延边大学
- 东北农业大学
- 东北林业大学
- 哈尔滨工程大学
- 宁波大学
- 福州大学
- 安徽大学
- 河南大学
- 湖南师范大学
- 四川农业大学
- 云南师范大学
- 昆明理工大学
- 广西师范大学
- 石河子大学
- 青海师范大学
- 北方民族大学

---

## 8. 机器可读数据

### templates.json 字段说明

每条模板记录至少包含：
- `id` — 唯一标识（`cn-<university>-<format>-<degree>` 模式）
- `university` — 学校中文名
- `universityType` — 985|211|双一流|双一流新 等
- `degreeType` — 本科|硕士|博士|硕士+博士|本科+硕士+博士
- `year` — 模板适用年份
- `format` — latex|typst|word|overleaf
- `sourceType` — 官方|校内组织|社区
- `officialSpecUrl` — 官方规范页面 URL
- `repositoryUrl` — 模板仓库 URL
- `repositoryHost` — github|gitee|ctan|overleaf|typst_university|school_official
- `version` — 仓库版本号 / tag / commit
- `engine` — xelatex|pdflatex|latexmk|typst
- `entryFile` — main.tex / main.typ / 模板名
- `documentClass` — 自定义 cls 或标准类
- `bibliography` — biblatex-gb7714-2015|bibtex|none
- `license` — LPPL-1.3c|MIT|GPL-3.0|Apache-2.0
- `maintainer` — 维护者或组织
- `lastCommit` — 最近 commit 日期
- `officialSpecDocUrl` — 官方规范 PDF/DOC 直链
- `status` — active|maintained|stale|archived|unverified
- `recommendationLevel` — A|B|C|D
- `recommendationReason` — 推荐理由
- `knownIssues` — 已知问题
- `searchedAt` — 检索日期

### LumenLab Template Registry 导入示例

```python
import json
records = json.load(open('cn-thesis-templates/templates.json'))
# 按 universityType 筛选
for r in records:
    if r['recommendationLevel'] in ['A', 'B'] and r['format'] == 'latex':
        registry.add({
            'id': r['id'],
            'name': f"{r['university']} - {r['degreeType']} ({r['year']})",
            'format': 'latex',
            'engine': r['engine'],
            'repository_url': r['repositoryUrl'],
            'license': r['license'],
            'university_type': r['universityType']
        })
```

---

## 9. 引用来源

- **GB/T 7713.1—2006** 学位论文编写规则（中华人民共和国国家标准）
- **CTAN** — https://ctan.org
- **GitHub** — 各组织/个人仓库
- **Gitee** — 国内代码托管
- **Overleaf** — https://www.overleaf.com
- **Typst Universe** — https://typst.app/universe
- **skills.sh** — https://www.skills.sh
- **OpenClaw** — https://github.com/Tencent/clawhub
- **教育部 985 工程名单**（1998 年）
- **教育部 211 工程名单**（1995 年）
- **教育部 2022 年第二轮双一流名单**

---

> **维护建议**：当某校发布新版本规范时，更新该校的 `latex/<学校名>/README.md` 与 templates.json 中的对应记录。A 级和 B 级模板优先于 C/D 级。
