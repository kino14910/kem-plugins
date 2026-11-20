# KEM 插件市场

这个仓库输出 KEM `format: 1` 索引，以及供 Host 的 npm 安装器读取的静态 registry。初始插件 **Market Hello**（`market-hello`，npm 包 `kem-market-hello@1.0.0`）是无依赖的 API v1 Host 插件。启用和停用时分别在 Host 日志中打印问候和告别，不创建窗口。

## 部署到 GitHub Pages

1. 把本仓库内容放到 GitHub 仓库的默认分支，并在 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。站点需允许 KEM 匿名访问。
2. 默认分支的 push 会构建并发布。也可以在 **Actions → Publish KEM plugin market** 手动运行默认分支。工作流从 `configure-pages` 取得实际站点 URL，使用下文相同的 `npm run build` 生成并上传 `dist/`。
3. 在 KEM 的 **运行时 → 发现** 添加部署地址加 `index.json`。普通 Pages 项目站点的索引地址为 `https://<owner>.github.io/<repo>/index.json`。如果站点部署在根路径，索引为 `https://<站点域名>/index.json`。站点首页显示实际索引中的插件，并可一键复制索引地址。

对接时填写 **索引地址**。registry 由索引声明，在普通项目站点上是 `https://<owner>.github.io/<repo>/registry/`。包元数据位于该地址下的 `kem-market-hello` 文件，tarball 位于 `https://<owner>.github.io/<repo>/registry/-/tarballs/kem-market-hello-1.0.0.tgz`。路径中的仓库名由实际部署决定。

## 本地构建

使用 Node.js 24（见 `.node-version`）和 npm 11，在仓库根目录运行。构建直接使用 npm 打包库内的插件，无需安装仓库依赖、登录 npm 或向 npm 发布。

```powershell
$env:MARKET_BASE_URL = 'https://example.github.io/kem-plugins/'
npm run build
npm test
```

```sh
MARKET_BASE_URL=https://example.github.io/kem-plugins/ npm run build
npm test
```

将示例替换为最终 HTTPS 站点地址。构建会重新生成 `dist/`，包含首页、`index.json`、`registry/` 下的无扩展名 npm 元数据及 `registry/-/tarballs/` 下的包。部署时保留目录结构。切换域名或站点子路径时应使用新的地址重建，已安装插件的 registry 标识也需要保持稳定。

Host 按索引中的精确版本创建 v3 lockfile，校验其中的 HTTPS tarball 地址和 `integrity`，然后以 `--allow-remote=none` 执行 `npm ci`。归档须与 registry 同源，并位于 registry 的路径下，npm 才会把它识别为 registry 包。构建使用 `npm pack` 输出的归档及校验值生成元数据，并检查 Host 和可选的客户端入口均已被打包。`npm test` 使用系统的 `tar` 读取发布用归档。

## 增加插件或版本

在 `plugins/<id>/<X.Y.Z>/` 放入 `package.json` 和可直接加载的 `.mjs` 文件。目录名须匹配 `kem.id` 和 `version`。沿用示例的 `kem` 字段，包括相对于包根目录的 `host` 和 API 版本 `1`。此静态 registry 支持无依赖、无 scope 的插件包和稳定版 `X.Y.Z`。入口文件的默认导出是 Cordis 插件，可以通过 Host 提供的 `ctx` 注册服务或生命周期效果。

保留已发布版本目录及源文件，修改代码时新增版本目录。构建按版本号降序列出保留的版本，并将最高版本设为 npm `latest`。同一插件须沿用 ID、npm 包名和 registry URL。

带窗口的插件可在 `kem.client` 中声明 `entry` 和 `label`。`entry` 指向包内的 UTF-8 `.html` 或 `.htm` 文件，体积上限为 2 MiB。把它加入 npm `files`。页面的 JS 和 CSS 都内联，并通过父 iframe 握手传入的 `MessagePort` 提供托盘菜单和桌面歌词。播放器以 `blob:` URL 播放用户选择的文件，宿主 CSP 需允许 `media-src blob:`。

## 验收本地播放器

**本地播放器**（`local-player`，`kem-local-player@1.0.0`，作者 `kino`）需要支持市场插件窗口的 KEM 桌面版。将构建产物通过 HTTPS 提供给 KEM，在 **运行时 → 发现** 添加市场索引后安装并启用。打开侧栏 **本地播放器**，选择含音频文件及同目录、同名 `.lrc` 的文件夹。首曲会选中，点击播放后才开始。确认播放器音量、暂停和下一首可用，桌面歌词按时间切换，无歌词时显示文件名。切到其他 KEM 页面时，播放和托盘控制应继续。停用或卸载应停止播放，移除托盘项并清空桌面歌词。

支持按扩展名筛选 MP3、FLAC、OGG、Opus、WAV、M4A、AAC 和 WebM，实际解码能力取决于桌面运行时。歌词沿用 UTF-8 LRC 和 1 MiB 文件上限。切页后台播放依赖宿主保留同一个 iframe。停用、卸载、重载窗口或退出后需要重新选目录。

构建完成后，可用以下命令在 Chrome 里从实际归档跑一遍沙盒冒烟测试。测试以合成 WAV 和 LRC 检查目录配对、音量、托盘协议、隐藏页面时的自动切曲和清理。原生目录选择器、系统托盘和桌面歌词窗口按上面的 KEM 步骤验收。

```sh
node tests/prepare-local-player-browser.mjs
npx --package @playwright/cli playwright-cli -s=kem-local-player open --browser=chrome
npx --package @playwright/cli playwright-cli -s=kem-local-player run-code --filename=.cache/local-player-browser.js
npx --package @playwright/cli playwright-cli -s=kem-local-player close
```
