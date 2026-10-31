# iOS 源码构建（实验性）

本仓库新增了基于 Capacitor 的 iOS 外壳。它把现有 Vite Web 版放进 WKWebView；它不是 Electron 移植，也不包含桌面主进程。此仓库目前不提供预编译 IPA。

## 构建要求

需要 macOS、Xcode、Node.js 24 或更新版本，以及可用于目标设备的 Apple 签名团队/证书/描述文件。当前 Capacitor 配置的 Bundle ID 是 `top.izuna.foliamajor.ios`；若不能在你的 Apple 开发团队下注册，请在 `capacitor.config.ts` 中换成你拥有的唯一 Bundle ID。Linux 和 Windows 不能执行 iOS/Xcode 的归档与签名步骤。

## 准备 Web 版服务

Folia 的 iOS 外壳使用与浏览器版相同的 Web 构建。音乐平台的 Web API 需要单独部署，并配置 `VITE_NETEASE_API_BASE`、`VITE_KUGOU_API_BASE`、`VITE_QQ_API_BASE` 等必要环境变量后重新构建。运行在 iPhone 上的 WebView 无法访问构建机的 `localhost`；这些地址必须是手机可访问的 HTTPS 服务。仅把 `/api/qq` 这类相对路径写进本地 IPA 不会把对应服务端函数一并打包。

不要把 AI 服务密钥或其他长期秘密写进 `VITE_*` 构建变量：这些值会随前端资源分发，不能视为保密。

## 在 Mac 上构建

```sh
npm ci
npm run ios:sync
npm run ios:open
```

在 Xcode 中选择 Folia 的 `App` scheme 和目标 iPhone，配置自己的 Signing Team，然后用 **Product → Archive** 构建。完成归档后，可在 Organizer 中导出适用于你所选分发方式的 IPA。安装到其他设备或通过 TestFlight/App Store 分发所需的配置，取决于 Apple 对应的签名与分发流程。

`npm run ios:sync` 会先运行现有 `npm run build`，再把 `dist/` 同步到 `ios/`。修改前端、依赖或 Vite 构建配置后，需要重新运行它。

仓库的 [GitHub Actions 工作流](../.github/workflows/ios-build.yml) 可在推送相关改动到 `main` 后运行，也可从 Actions 手动触发。它会在 macOS runner 上编译，并上传保留 7 天的 `Folia-unsigned.ipa`。该工件没有代码签名，不能直接安装到 iPhone；要生成可安装包，还需配置 Apple 证书和匹配的 provisioning profile，并按直接安装或 TestFlight/App Store 选择导出方式。当前工作流不会读取或管理这些签名资料。

## Spotify 与平台差异

此 iOS 外壳不会继承桌面 Spotify 播放。当前 iPhone 集成使用 OAuth PKCE 读取用户选定的一个歌单；它不会把 Spotify 音频作为 Folia 自己的 `<audio>` 源，也不会保留 Folia 的 Spotify 歌词同步、音频可视化或音效链路。歌单中的歌曲可点开 Spotify，由 Spotify app 处理播放。

### 连接用户指定的歌单

首页 Spotify 入口只读取歌单 `好`（ID `3i767yrQJ0zACU50f1FyCa`），不会扫描账号的其他歌单。首次使用需要用户在 iPhone 上授权 Spotify；刷新令牌存放在该设备的 iOS Keychain（不启用 iCloud 同步）。用户和歌单摘要仅留在应用运行内存中，曲目列表在关闭页面时清空；Spotify 元数据不会写入 Folia 数据库。断开 Spotify 时会删除这台设备上的刷新令牌。

Spotify Developer Dashboard 应用需要配置 iOS Bundle ID `top.izuna.foliamajor.ios` 和精确匹配的回调 URI `top.izuna.foliamajor.ios://spotify-callback`；此回调 scheme 同时注册在 `ios/App/App/Info.plist`。OAuth 使用 PKCE，不需要把 Client Secret 放进 IPA。请求范围仅为读取所需的 `user-read-private`、`playlist-read-private` 和 `playlist-read-collaborative`，没有写入权限。Spotify Development Mode 要求开发者账号持有有效 Premium，并将测试用户加入应用允许列表；当前开发模式最多允许 5 位用户。读取私密歌单还要求登录账号是歌单所有者或协作者。

Spotify 的 [2025 OAuth 安全公告](https://developer.spotify.com/blog/2025-02-12-increasing-the-security-requirements-for-integrating-with-spotify) 与 [应用设置说明](https://developer.spotify.com/documentation/web-api/concepts/apps)列出 iOS 自定义 scheme 的使用方式；OAuth 请求必须与 Dashboard 中登记的 URI 完全一致。Web API 歌单曲目接口现为 [`GET /playlists/{id}/items`](https://developer.spotify.com/documentation/web-api/reference/get-playlists-items)。这是账户读取/外部跳转，不是 Folia 内播放。

参考：[Capacitor iOS 文档](https://capacitorjs.com/docs/ios)、[Spotify PKCE 文档](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow)、[Spotify Redirect URI 规则](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri)。
