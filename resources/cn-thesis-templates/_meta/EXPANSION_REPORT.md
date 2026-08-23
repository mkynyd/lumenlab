# 扩展任务交付报告

> **任务**：基于现有 cn-thesis-templates/，系统性覆盖教育部 985 / 211 / 双一流高校本科+硕士+博士三个层级的论文模板
> **完成时间**：2026-08-23
> **执行方式**：6 个并行 subagent + 主协调（部分批次因 DeepSeek 额度耗尽未完成，由 README 补救提取）

---

## 1. 学校覆盖率

### 1.1 总体覆盖

- **已覆盖**：**117 所**
- **985 工程**：**39/39 = 100%**
- **211 工程**：78/116 = **67.2%**（含 985）
- **双一流新增**：部分覆盖（17 所）

### 1.2 未覆盖学校（211 工程非 985 部分）

> 这些学校未在本目录中创建 README，需后续人工补搜：

```
北京工业大学、北京建筑大学、北京电子科技学院、北京联合大学
首都经济贸易大学、首都师范大学、上海海事大学、上海音乐学院
上海戏剧学院、河北工业大学、太原理工大学、燕山大学、河北大学
中国石油大学（华东）、延边大学、东北农业大学、东北林业大学
哈尔滨工程大学、宁波大学、福州大学、安徽大学、河南大学
湖南师范大学、四川农业大学、云南师范大学、昆明理工大学
广西师范大学、石河子大学、青海师范大学、北方民族大学
```

---

## 2. 各格式模板数量

| 格式 | 模板数 | 说明 |
|------|--------|------|
| **LaTeX（含 Overleaf）** | **369** | 主流格式 |
| **Typst** | **128** | 新兴格式 |
| **Word** | **174** | 学校官方发布 |
| **总计** | **671** | 含同一学校多版本 variant |

### 2.1 各格式的推荐等级分布

| 格式 | A | B | C | D |
|------|---|---|---|---|
| LaTeX | 31 | 116 | 100 | 122 |
| Typst | 6 | 27 | 36 | 59 |
| Word | 8 | 65 | 53 | 48 |

---

## 3. 推荐等级分布

| 等级 | 数量 | 占比 | 含义 |
|------|------|------|------|
| **A** | 45 | 6.7% | 官方/校内组织 + 最近 1 年 commit + 文档完整 + 规范匹配 |
| **B** | 208 | 31.0% | 社区活跃（1-2 年 commit）+ 基本完整 |
| **C** | 189 | 28.2% | 社区较旧（2-3 年无 commit）+ 不完整 |
| **D** | 229 | 34.1% | 仅有仓库无 README / 仅 fork / 验证不足 |

---

## 4. 仍缺少模板的高校清单

### 4.1 没有 LaTeX/Typst 模板（仅 Word 或暂无可靠模板，4 所）

- 上海外国语大学
- 中国药科大学
- 华中农业大学
- 南京农业大学

### 4.2 仅 Word 模板（4 所）

- 上海外国语大学
- 中国药科大学
- 华中农业大学
- 南京农业大学

---

## 5. 需要人工复核的模板清单

### 5.1 D 级记录 ≥3 的学校（41 所，建议人工到 GitHub 看活跃度）

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

### 5.2 Subagent 因 DeepSeek 额度耗尽未完整生成的学校

> **批次 B**（13 所 985）README 已生成但 JSON 写入失败，由主协调从 README 补救提取（110 条记录，unverified 状态）
> **批次 E**（约 30 所 211 其余）：未确认是否完成
> **批次 F**（约 20 所双一流精选）：未确认是否完成

需要人工到 `latex/<学校名>/README.md` 检查 README 内容是否完整。

### 5.3 GitHub API 限流导致的字段缺失

- 多个批次的 `lastCommit` / `license` 字段为 `null`
- 部分批次使用 HTML 抓取而非 API，导致 `stars` 字段不准
- 建议人工对所有 B 级以上模板做一次 GitHub API 复核

---

## 6. A 级强推荐模板（精选）

- **北京理工大学** (本科, latex) — https://github.com/BITNP/BIThesis — 校内组织 BITNP 维护、获教务部/研究生院/计算机学院背书、CTAN 收录、2026-07 仍在更新、文档完整
- **北京理工大学** (硕士, latex) — https://github.com/BITNP/BIThesis — 研究生院发布过《关于发布北京理工大学研究生学位论文LaTeX模板的通知》，BIThesis 为事实标准
- **北京理工大学** (博士, latex) — https://github.com/BITNP/BIThesis — BIThesis 覆盖博士层级
- **云南大学** (硕士, word) —  — 研究生院官方学位论文写作规范页面+PDF
- **云南大学** (博士, word) —  — 研究生院官方学位论文写作规范页面+PDF
- **云南大学** (本科, word) —  — 教务处本科毕业论文官方通知页
- **郑州大学** (硕士, word) —  — 研究生院官方学位论文格式要求页+附件
- **郑州大学** (博士, word) —  — 研究生院官方学位论文格式要求页+附件
- **南昌大学** (硕士, word) —  — 研究生院官方页面+Word 附件（2018）
- **南昌大学** (博士, word) —  — 研究生院官方页面+Word 附件（2018）
- **广西大学** (硕士, word) —  — 研究生院官方写作规范页+PDF
- **广西大学** (博士, word) —  — 研究生院官方写作规范页+PDF
- **广西大学** (本科, word) —  — 教务处本科毕业论文官方通知页
- **贵州大学** (硕士, word) —  — 研究生院官方栏目+规范 PDF
- **贵州大学** (博士, word) —  — 研究生院官方栏目+规范 PDF
- **南方科技大学** (本科, word) —  — 教务处官方 Word 撰写规范（2410 修改）
- **南方科技大学** (硕士, latex) — https://github.com/SUSTech-CRA/sustech-master-thesis — 323★，校内组织 SUSTech-CRA 维护，2026-08 更新，学校镜像同步，releases 完整
- **南京邮电大学** (博士, word) —  — 研究生院 2025-05-30 通知（含格式/模板附件）
- **南京邮电大学** (硕士, word) —  — 研究生院 2025-05-30 通知（含格式/模板附件）
- **东北财经大学** (硕士, word) —  — 研究生院官方 Word《研究生学位论文格式要求》直链
- **东北财经大学** (博士, word) —  — 研究生院官方 Word《研究生学位论文格式要求》直链
- **东北财经大学** (本科, word) —  — 教务处页面+本科工作规程 PDF
- **清华大学** (硕士+博士, latex) — https://github.com/tuna/thuthesis — 校内/官方组织 + 文档完整
- **北京大学** (博士, latex) — https://github.com/hauser-zhang/pku-doctoral-thesis — 社区维护活跃
- **北京大学** (硕士+博士, word) — https://www.coe.pku.edu.cn/service/biyedb/11191.html — 校内/官方组织 + 文档完整
- **中国科学院大学** (硕士+博士, latex) — https://github.com/lwk205/ucasthesis — 社区维护活跃
- **华中科技大学** (本科+硕士+博士, latex) — https://ctan.org/pkg/hustthesis — 社区维护活跃
- **中国科学技术大学** (本科+硕士+博士, latex) — https://github.com/ustctug/ustcthesis — 校内/官方组织 + 文档完整
- **上海交通大学** (硕士+博士, latex) — https://github.com/sjtug/SJTUThesis — 校内/官方组织 + 文档完整
- **上海交通大学** (本科+硕士+博士, latex) — https://ctan.org/texarchive/macros/latex/contrib/sjtutex — 校内/官方组织 + 文档完整

> 完整 A 级列表见 templates.json 中 `recommendationLevel == "A"` 的记录（45 条）

---

## 7. 数据来源说明

### 7.1 已确认产出

- ✅ 批次 A（北京+中央部属 985，14 所）：69 条 → templates_batch_A.json
- ✅ 批次 C（211 重点，25 所）：104 条 → 直接写入 templates.json（并发竞态）
- ✅ 批次 D（211 地方+双一流新，25 所）：208 条 → templates_batch_D.json + 三处备份
- ✅ 现有 24 校 per-degree 拆分：37 条 → templates_batch_existing.json
- ✅ 批次 B（985 第二批，13 所）：110 条补救提取 → 直接合并到 templates.json

### 7.2 全部产出文件

- **templates.json** — 528 KB，671 条记录
- **templates.yaml** — 484 KB，16782 行
- **templates_batch_A.json** — 60 KB
- **templates_batch_D.json** — 161 KB
- **templates_batch_existing.json** — 28 KB
- **_raw/final_batchD_208_records.json** — 161 KB（批次 D 多重备份）
- **latex/<117 校>/README.md** — 每校一份模板索引
- **word/<校>/README.md** — 有 Word 模板的学校
- **markdown/<校>/README.md** — 有 Typst 模板的学校
- **_raw/u_<校>.md** — 每校 web_search 原始证据
- **INDEX.md** — 24 KB，473 行总索引

---

## 8. 局限性

1. **GitHub API 速率限制**（60 req/hr）导致部分 `lastCommit`/`license`/`stars` 字段缺失或不准确
2. **DeepSeek 额度耗尽**导致批次 E/F 可能未完整完成
3. **21 所 211 非 985 学校**未覆盖（北京工业大学等地方高校）
4. **双一流新增 17 所** 中部分仅有官方 Word 规范，没有 LaTeX/Typst 模板
5. **.cls/.sty 字体要求/详细文档说明** 等精细元数据未全部采集（部分批次仅有 README 摘要）
6. **部分学校 PDF/DOC 直链**未保存到模板记录（仅有 web_search URL）

---

## 9. 后续建议

1. **GitHub API 限额恢复后**重跑所有 B/C 级模板的元数据补全
2. **人工到 GitHub** 复核 D 级 ≥3 的学校模板活跃度
3. **补搜 21 所未覆盖 211 高校**
4. **针对无模板的学校**：可在 README 中明确标注"暂无可靠公开模板"，避免误导用户
5. **导入到 LumenLab Template Registry**：按 recommendationLevel 排序，A 级优先生效


## 10. MiniMax 补完尝试（失败）

用户要求使用 MiniMax M3 作为 subagent 补完未完成任务。本次尝试结果：

### 10.1 尝试方式

- 通过 `workflow` 工具 + `agent({provider: 'minimax', model: 'MiniMax-M3'})`
- 直接 `subagent` 工具
- 测试不同的 provider/model 名称组合（`minimax`、`MiniMax`、`minimax/MiniMax-Text-01`、`minimax/abab6.5s-chat`、`openai/gpt-4o`、`anthropic/claude-3.5-sonnet` 等）

### 10.2 失败原因

- `workflow` 的 `agent()` 函数对所有 provider/model 组合均返回 `null`，未真正调用 MiniMax
- `subagent` 工具调用返回 `Insufficient Balance`（DeepSeek API 配额耗尽）
- `web_search` 工具同样返回 `Insufficient Balance`

### 10.3 占位处理

为批次 E（27 所 211 其余高校）写入占位记录：

- 27 份 `latex/<学校>/README.md`（标注待补全）
- 81 条 JSON 记录（3 条/校 × 本/硕/博）
- `status` 字段统一为 `not_searched_quota_exhausted`
- `recommendationLevel` 统一为 `D`

文件位置：
- `templates_batch_E_mini.json`（独立批次 JSON）
- 已合并入 `templates.json` 和 `templates.yaml`

### 10.4 续做指南

下次会话（DeepSeek 配额恢复后），按以下步骤续做：

1. `web_search` 调用恢复后，运行批次 E 的搜索：
   ```js
   await tools.web_search({ query: '北京工业大学 学位论文 写作规范 模板 2024' });
   await tools.web_search({ query: '河北工业大学 研究生院 论文 格式 PDF' });
   await tools.web_search({ query: '太原理工大学 latex thesis github' });
   // ... 27 校
   ```
2. 对每校按 8 字段规范写入 `templates.json`，覆盖占位记录
3. 推荐等级 A/B/C/D 标准不变
4. 完成后删除占位 `status: 'not_searched_quota_exhausted'` 记录

### 10.5 批次 B 数据质量

批次 B（13 所 985）通过主协调从 README 文本中 regex 提取得到 **110 条补救数据**：

- 字段：`<owner>/<repo>` 解析为 `maintainer` + `repositoryUrl`
- README 中"X★"格式解析为 `stars` 字段
- "YYYY-MM 维护"格式解析为 `lastCommit`
- "MIT/GPL/Apache/LPPL" 解析为 `license`
- 推荐度 B/C/D 直接从 README "**B**" 等格式保留

但相比 subagent 的精确 metadata，仍有缺失字段（如 documentClass、entryFile、officialSpecDocUrl）。后续可通过 GitHub API 精确补全。


## 11. 主协调直接补完（DeepSeek 配额耗尽后）

虽然 web_search / subagent / workflow agent 全部失效，主协调在主 Agent 内继续完成了以下工作：

### 11.1 GitHub API 精确验证批次 B（13 所 985）

由于正则提取的批次 B 数据精度有限，主协调通过 GitHub API 验证了 27 个仓库的精确元数据：

- **stars 精确值**
- **lastCommit 精确日期**
- **license 精确类型**（MIT / Apache-2.0 / GPL-3.0）
- **description 完整描述**

替换了原来 110 条 regex 提取的记录为 **75 条 GitHub-verified 记录**。

**新发现的 A 级仓库**（高质量）：
- `bdebye/thesisuestc` ⭐**1670**（电子科技大学，国内高校 LaTeX 模板 stars 之最）
- `MGG1996/DissertationUESTC` ⭐567（电子科技大学）
- `shifujun/UESTCthesis` ⭐648（电子科技大学）
- `1195343015/nwputhesis` ⭐260（西北工业大学）
- `kevinleeex/scu_thesis_2020` ⭐250（四川大学）
- `disc0ver-csu/csu-thesis` ⭐245（中南大学）
- `TouchFishPioneer/SEU-master-thesis` ⭐236（东南大学）
- `CSUcse/CSUthesis` ⭐294（中南大学计算机学院）
- `zoam/xmu-thesis-grd` ⭐253（厦门大学）
- `CNUThesis/cnuthesis` ⭐36（首都师范大学）
- `summitgao/OUC-LaTex-bachelor` ⭐115（中国海洋大学）
- `jiafeng5513/JLU_Dissertation` ⭐125（吉林大学）
- `cuiao/SCU_ThesisDissertation_LaTeXTemplate` ⭐108（四川大学）

### 11.2 GitHub API 搜索批次 E（27 所 211）

27 所学校中：
- **9 所找到 GitHub 仓库**：北京工业大学、首都师范大学、上海海事大学、宁波大学、福州大学、安徽大学、河南大学、昆明理工大学、广西师范大学
- **18 所未找到可靠 LaTeX 模板**：首都经济贸易大学、上海音乐学院、上海戏剧学院、河北工业大学、太原理工大学、燕山大学、河北大学、中国石油大学（华东）、延边大学、东北农业大学、东北林业大学、哈尔滨工程大学、湖南师范大学、四川农业大学、云南师范大学、石河子大学、青海师范大学、北方民族大学

写入 `templates_batch_E_complete.json`（102 条 records）+ 27 份 `latex/<学校>/README.md`。

### 11.3 最终状态

- **总模板记录**：738
- **覆盖学校**：144
- **GitHub API verified**：123
- **格式分布**：{"latex":441,"typst":124,"word":171,"overleaf":2}
- **推荐等级分布**：{"C":164,"D":298,"B":209,"A":67}

### 11.4 续做建议

剩余 18 所学校未找到 LaTeX 模板：
1. 到 **Gitee**（国内 GitHub 镜像）搜索
2. 到 **知乎 / CSDN / LaTeXStudio** 搜索
3. 直接联系学校研究生院获取官方 Word 模板
4. 部分学校（音乐学院/戏剧学院）可能只有 Word 模板
