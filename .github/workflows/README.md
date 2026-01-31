# GitHub Actions CI/CD 配置说明

本项目配置了自动化 CI/CD 流程，包括自动测试和 npm 发布。

## 工作流程

### 1. CI 工作流 (`.github/workflows/ci.yml`)

**触发条件**：
- 创建或更新 Pull Request 到 main 分支
- 推送代码到 main 分支

**执行内容**：
- 安装依赖
- 运行所有测试 (`npm test`)
- 构建项目 (`npm run build`)

### 2. Release 工作流 (`.github/workflows/release.yml`)

**触发条件**：
- 推送代码到 main 分支
- package.json 版本号已更新

**执行内容**：
- 运行测试和构建
- 检查版本号是否变化
- 如果版本变化，自动发布到 npm
- 创建 GitHub Release

## 首次配置步骤

### 1. 创建 NPM Token

1. 登录 [npmjs.com](https://www.npmjs.com/)
2. 进入 **Access Tokens** 页面
3. 点击 **Generate New Token** → 选择 **Automation**
4. 复制生成的 token（只显示一次）

### 2. 配置 GitHub Secrets

1. 进入 GitHub 仓库设置
2. 点击 **Settings** → **Secrets and variables** → **Actions**
3. 添加以下 secret：
   - **Name**: `NPM_TOKEN`
   - **Value**: 粘贴上面复制的 npm token

### 3. 配置自动化版本号（可选）

如果你想自动管理版本号，可以使用 [semantic-release](https://github.com/semantic-release/semantic-release)：

```bash
npm install -D semantic-release @semantic-release/git @semantic-release/changelog
```

创建 `.releaserc.json`:

```json
{
  "branches": ["main"],
  "plugins": [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    "@semantic-release/changelog",
    "@semantic-release/npm",
    "@semantic-release/github",
    "@semantic-release/git"
  ]
}
```

## 使用方式

### 提交代码

```bash
# 修改代码后提交
git add .
git commit -m "feat: add new feature"
git push
```

### 发布新版本

```bash
# 1. 更新版本号（使用 npm version 命令）
npm version patch  # 1.0.29 -> 1.0.30 (bug 修复)
npm version minor  # 1.0.29 -> 1.1.0 (新功能)
npm version major  # 1.0.29 -> 2.0.0 (破坏性更新)

# 2. 推送代码和标签
git push && git push --tags
```

GitHub Actions 会自动：
- ✅ 运行测试
- ✅ 构建项目
- ✅ 发布到 npm (@maplezzk/mcps)
- ✅ 创建 GitHub Release

### 跳过发布

如果你不想触发发布，在提交信息中添加 `[skip release]`：

```bash
git commit -m "chore: update docs [skip release]"
git push
```

## PR 流程

1. 创建新分支：`git checkout -b feature/xxx`
2. 开发并提交代码
3. 推送分支：`git push origin feature/xxx`
4. 在 GitHub 上创建 Pull Request
5. CI 自动运行测试，确保通过
6. 合并 PR 到 main 分支
7. 如果版本号有变化，自动发布到 npm

## 注意事项

- ⚠️ 确保 `prepublishOnly` 钩子配置正确，会先运行测试再发布
- ⚠️ 只有 main 分支的代码推送会触发发布
- ⚠️ 版本号必须变化才会发布（避免重复发布）
- ⚠️ NPM_TOKEN 需要有 Automation 权限

## 查看工作流状态

在 GitHub 仓库页面点击 **Actions** 标签，可以看到所有工作流的运行记录。
