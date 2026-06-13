# PostgreSQL + pgvector 数据库运维指南

## 环境准备

### Docker 方式（推荐）

```bash
docker compose up -d postgres
```

### macOS Homebrew 方式

```bash
brew install postgresql@17 pgvector
brew services start postgresql@17
createdb ai_workspace
psql -d ai_workspace -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

## 迁移流程

### 1. 生成 Prisma Client

```bash
npx prisma generate
```

### 2. 执行迁移

```bash
npx prisma migrate dev
```

### 3. 查看数据库

```bash
npx prisma studio
```

### 4. 确认 pgvector 扩展

```sql
SELECT * FROM pg_extension WHERE extname = 'vector';
```

### 5. 重置开发数据库

```bash
npx prisma migrate reset
```

## 数据库连接

`.env` 中的 DATABASE_URL：

```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ai_workspace?schema=public"
```

## 数据表结构

| 表名 | 说明 |
|------|------|
| User | 用户账户 |
| ApiKey | API Key（AES-256-GCM 加密存储） |
| Conversation | 对话记录 |
| Message | 消息记录 |
| Project | 项目空间 |
| FileAsset | 上传文件 |
| DocumentChunk | 文件内容向量块（pgvector） |

## SQLite 迁移说明

本项目已从 SQLite 迁移到 PostgreSQL。原有 `dev.db` 不再作为主数据库。

如需迁移旧 SQLite 数据到 PostgreSQL，需要编写导出导入脚本。本次 MVP 默认不迁移旧数据。

## pgvector 索引

HNSW 索引可在数据量增大后手动创建（需要 pgvector 0.5+）：

```sql
CREATE INDEX IF NOT EXISTS document_chunk_embedding_hnsw_idx
ON "DocumentChunk"
USING hnsw (embedding vector_cosine_ops);
```

如果本地 pgvector 版本不支持 HNSW，可以先不加该索引，后续按需启用。
