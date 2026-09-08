# 天津医科大学 — Typst / 现代排版模板

> Typst 是新一代排版系统，比 LaTeX 更易上手、编译更快。

## 模板

未发现 天津医科大学 专用 Typst 模板。可参考以下通用方案：

- 通用中文论文 Typst 模板（Typst Universe 检索 "thesis" / "chinese"）
- 基于官方 Word 模板手工转换为 Typst 样式
- 复用本目录其他学校的 Typst 模板再按本校规范修改

## 为什么选 Typst

- 编译速度极快（秒级 vs LaTeX 分钟级）
- 配置文件使用 TOML/JSON，无需宏包地狱
- 中文支持日趋完善（ctex 风格已支持）
- 主流在线编辑器：[Typst.app](https://typst.app)

## 与 LaTeX 的对比

| 维度 | LaTeX | Typst |
|------|-------|-------|
| 编译速度 | 慢（需多次）| 极快 |
| 学习曲线 | 陡 | 较缓 |
| 中文支持 | 成熟（CTeX/xeCJK）| 新（但已可用） |
| 生态/模板 | 极丰富 | 发展中 |
| 数学公式 | 顶级 | 优秀 |

## 配合 LaTeX 模板使用建议

如果学校没有 Typst 模板，仍然推荐 LaTeX 模板（参见 `../latex/天津医科大学/README.md`）。
