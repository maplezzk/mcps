# 开发工作流

欢迎贡献代码！以下是参与项目开发的完整流程。

## 目录

- [环境准备](#环境准备)
- [本地开发](#本地开发)
- [测试](#测试)
- [提交规范](#提交规范)
- [PR 流程](#pr-流程)
- [发布流程](#发布流程)
- [CI/CD](#cicd)
- [代码规范](#代码规范)

---

## 环境准备

**前置要求：**
- Node.js >= 20
- npm >= 9
- Git

**克隆项目：**
```bash
git clone https://github.com/maplezzk/mcps.git
cd mcps
```

**安装依赖：**
```bash
npm install
```

---

## 本地开发

**开发模式（使用 ts-node 直接运行）：**
```bash
npm run dev -- <command>
# 例如
npm run dev -- ls
npm run dev -- start
```

**构建项目：**
```bash
npm run build
```

**运行构建后的版本：**
```bash
npm start -- <command>
# 或者
node dist/index.js <command>
```

---

## 测试

**运行测试：**
```bash
# 运行所有测试
npm test

# 监听模式（开发时推荐）
npm run test:watch

# 启动测试 UI 界面
npm run test:ui

# 生成测试覆盖率报告
npm run test:coverage
```

**测试要求：**
- 所有测试必须通过
- 新功能需要添加相应的测试
- 保持测试覆盖率在合理水平

---

## 提交规范

**提交信息格式：**
```
<type>: <description>

[optional body]

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
```

**提交类型（type）：**
- `feat`: 新功能
- `fix`: 修复 bug
- `chore`: 构建过程或辅助工具的变动
- `docs`: 文档更新
- `refactor`: 重构（既不是新增功能，也不是修复 bug）
- `style`: 代码格式调整（不影响代码运行的变动）
- `test`: 增加测试
- `perf`: 性能优化

**示例：**
```bash
feat: 支持可配置的 daemon 启动超时时间

新增功能：
- 支持通过命令行参数 --timeout/-t 设置超时
- 支持通过环境变量 MCPS_DAEMON_TIMEOUT 设置超时
- 支持通过配置文件 daemonTimeout 字段设置超时

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
```

---

## PR 流程

**⚠️ 重要规范：**
- **永远不要直接在 `main` 分支上提交代码**
- **版本号必须使用 `npm version` 命令更新，禁止手动修改 `package.json`**

### 1. 创建功能分支（必须）

```bash
# 从 main 分支创建新分支
git checkout main
git pull origin main
git checkout -b feature/your-feature-name

# 或 bug 修复分支
git checkout -b fix/your-bug-fix
```

**分支命名规范：**
- `feature/` - 新功能
- `fix/` - bug 修复
- `refactor/` - 重构
- `docs/` - 文档更新
- `chore/` - 构建/工具更新

### 2. 开发并提交

```bash
# 进行开发...
npm run build  # 确保构建成功
npm test       # 确保测试通过

# 提交代码（在功能分支上提交）
git add .
git commit -m "feat: 你的功能描述"

# ⚠️ 不要在 main 分支提交！如果误提交到 main，需要重置：
# git checkout main
# git reset --hard HEAD~1  # 回退到上一个提交
# git checkout -b feature/your-feature-name
# git cherry-pick <commit-hash>  # 将提交移到新分支
```

### 3. 更新版本号（如需要）

```bash
# ⚠️ 必须使用 npm version 命令，禁止手动修改 package.json

# Patch 版本（bug 修复）
npm version patch

# Minor 版本（新功能）
npm version minor

# Major 版本（破坏性变更）
npm version major

# 预发布版本（可选）
npm version prerelease --preid beta
```

### 4. 推送并创建 PR

```bash
# 推送分支和标签（如果有版本更新）
git push origin feature/your-feature-name
git push origin v1.x.x  # 如果有版本标签
```

然后访问 GitHub 创建 Pull Request，或在命令行使用：
```bash
gh pr create --title "feat: 功能标题" --body "PR 描述"
```

### 5. PR 检查清单（创建 PR 前必须检查）

- ✅ 从最新 `main` 分支创建的功能分支
- ✅ 代码已提交到功能分支（非 main 分支）
- ✅ **新功能包含对应的单元测试**
- ✅ **版本号已使用 `npm version` 更新（如需要发布）**
- ✅ `npm run build` 构建成功
- ✅ `npm test` 所有测试通过
- ✅ 提交信息符合规范
- ✅ PR 描述清晰说明了变更内容

### ⚠️ 常见错误（真实案例）

| 错误 | 后果 | 正确做法 |
|------|------|----------|
| 直接在 `main` 分支开发 | 污染主分支，无法创建干净的 PR | 始终创建 `feature/` 或 `fix/` 分支 |
| PR 创建后才更新版本号 | 版本提交不在 PR 中，合并后版本不一致 | **提 PR 前**执行 `npm version` |
| PR 合并后继续往旧分支提交 | 提交无法进入新的 PR，需要 cherry-pick | PR 合并后，从最新的 `main` 创建新分支 |
| 新功能不写测试 | 代码质量无法保证，容易回归 | 功能代码和测试代码一起提交 |

### 6. 解决冲突（如有）

```bash
# 如果 main 分支有更新，先合并最新代码
git fetch origin
git merge origin/main

# 解决冲突后
git add .
git commit -m "chore: merge main and resolve conflicts"
git push origin feature/your-feature-name
```

### 7. 功能开发完整流程（正确示例）

```bash
# 1. 切换到 main 并更新
git checkout main
git pull origin main

# 2. 创建功能分支
git checkout -b feature/my-feature

# 3. 开发功能并编写测试...
# - 修改代码
# - 编写单元测试
# - 确保测试覆盖新功能

# 4. 构建和测试
npm run build
npm test

# 5. 提交代码（包括功能代码和测试代码）
git add .
git commit -m "feat: 新增 xxx 功能

- 功能描述...
- 添加单元测试

Co-Authored-By: xxx"

# 6. 更新版本号（如需要发布）
npm version minor  # 或 patch / major

# 7. 推送分支和标签
git push origin feature/my-feature
git push origin v1.x.x  # 版本标签

# 8. 创建 PR
gh pr create --title "feat: xxx" --body "..."
```

### 8. 常见错误修复

**如果误提交到 `main` 分支：**
```bash
# 1. 保存当前提交的哈希值
git log --oneline -1
# 记录 commit hash，例如：abc1234

# 2. 回退 main 分支
git checkout main
git reset --hard HEAD~1  # 回退最近一个提交
# 或回退到远程版本：git reset --hard origin/main

# 3. 创建功能分支并恢复提交
git checkout -b feature/your-feature-name
git cherry-pick abc1234  # 使用刚才记录的 hash

# 4. 推送功能分支
git push origin feature/your-feature-name
```

**如果 PR 已合并还继续往旧分支提交：**
```bash
# 1. 保存新提交的哈希值（在旧分支上）
git log --oneline -1

# 2. 切换到最新的 main
git checkout main
git pull origin main

# 3. 创建新分支
git checkout -b feature/new-feature

# 4. 将提交移到新分支
git cherry-pick <commit-hash>

# 5. 更新版本号（如需要）
npm version minor

# 6. 推送并创建新 PR
git push origin feature/new-feature
git push origin v1.x.x
gh pr create --title "feat: xxx" --body "..."
```

---

## 发布流程

项目采用**自动化发布**流程：

### 1. 版本管理（⚠️ 重要）

- **必须使用 `npm version` 命令更新版本号**
- **禁止手动修改 `package.json` 中的 version 字段**
- `npm version` 会自动：
  - 更新 `package.json` 中的版本号
  - 创建版本提交（如 `1.2.0`）
  - 创建 Git 标签（如 `v1.2.0`）

### 2. 发布触发

- 当 PR 合并到 `main` 分支时
- 如果版本号发生变化
- GitHub Actions 自动发布到 npm

### 3. 版本号规则

- `1.0.0` → `1.0.1` (Patch): bug 修复
- `1.0.1` → `1.1.0` (Minor): 新功能
- `1.1.0` → `2.0.0` (Major): 破坏性变更

### 4. 预发布版本（可选）

```bash
npm version prerelease --preid beta
# 生成 1.0.0-beta.0
```

预发布版本会发布到 npm 的 `beta` tag。

### 5. 跳过发布

如果 PR 不需要发布，在标题中添加 `[skip release]`：
```
[skip release] chore: 更新文档
```

---

## CI/CD

**CI 检查（.github/workflows/ci.yml）：**
- 每次 PR 和 push 都会触发
- 运行测试套件
- 构建项目
- 确保代码质量

**Release 自动化（.github/workflows/release.yml）：**
- PR 合并后触发
- 检测版本号变化
- 自动发布到 npm
- 创建 GitHub Release

---

## 代码规范

**TypeScript：**
- 使用 TypeScript 进行类型检查
- 运行 `npm run build` 检查类型错误

**代码风格：**
- 遵循项目现有代码风格
- 使用有意义的变量和函数名
- 添加必要的注释

**项目结构：**
```
mcps/
├── src/
│   ├── commands/      # 命令实现
│   ├── core/          # 核心功能
│   ├── types/         # 类型定义
│   └── tests/         # 测试文件
├── dist/              # 构建输出
├── DEVELOPMENT.md     # 开发文档
└── package.json
```
