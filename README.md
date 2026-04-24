# Windsurf-Tool
一键切号，一键查询积分，一键导入，批量注册，获取绑卡链接，自动绑卡免费使用。
适用于Mac Windows 
**完全开源** | 本地运行 | 无后端服务器

## 项目说明

这是一个完全开源的 Windsurf 账号管理工具，所有代码公开透明，可自行审查。

记得点个Star小星星，后续不会再维护和更新该项目。

# windsurf-tool交流群：1076321843       
# windsurfchat 无限对话插件https://version.anna.tf/versions.html

**本工具不收集任何用户数据**，所有账号信息仅存储在您的本地设备上。

## Token 获取原理

很多用户担心这是"账号收集工具"，这里详细说明 Token 的获取流程：

token是有过期时间大概是一个小时
### 认证流程

```
用户输入邮箱密码
        ↓
调用 Firebase 官方认证 API（通过 Cloudflare Workers 中转，解决国内访问问题）
        ↓
获取 Firebase idToken
        ↓
调用 Windsurf 官方 API: register.windsurf.com
        ↓
获取 API Key (Token)
```

### 技术细节

1. **Firebase 登录**：使用 Windsurf 官方的 Firebase API Key 进行身份验证
2. **Cloudflare Workers 中转**：仅用于解决国内无法直接访问 Firebase 的问题，中转服务不存储任何数据
3. **获取 API Key**：使用 Firebase 返回的 idToken 调用 Windsurf 官方接口 `RegisterUser` 获取 API Key

### 核心代码位置

- `js/accountLogin.js` - Token 获取核心逻辑
- `main.js` - 主进程 IPC 通信

关键代码片段：

```javascript
// 1. 使用邮箱密码登录 Firebase
const response = await axios.post(WORKER_URL + '/login', {
  email: email,
  password: password,
  api_key: FIREBASE_API_KEY
});

// 2. 使用 idToken 获取 Windsurf API Key
const response = await axios.post(
  'https://register.windsurf.com/exa.seat_management_pb.SeatManagementService/RegisterUser',
  { firebase_id_token: accessToken }
);
```

## 关于中转服务器

代码中使用了 Cloudflare Workers 中转服务（`js/constants.js`），这是因为国内无法直接访问 Firebase API。

**中转服务器仅做以下事情**：
1. 接收登录请求（邮箱、密码、API Key）
2. 转发到 Firebase 官方 API
3. 将 Firebase 返回的 Token 原样返回给客户端

**中转服务器不会**：
- 存储任何账号信息
- 记录任何请求日志
- 将数据发送到其他地方

如果您不信任中转服务器，可以：
1. 自行部署 Cloudflare Workers（代码开源）
2. 修改 `js/constants.js` 中的 `WORKER_URL` 为您自己的地址
3. 使用 VPN 直连 Firebase（无需中转）

### 自定义 Worker（推荐）

如果默认中转域名失效，可以使用仓库中的 `cloudflare-worker/firebase-auth-proxy.js` 自行部署一个 Cloudflare Worker：

1. 在 Cloudflare Workers 中创建一个新 Worker
2. 将 `cloudflare-worker/firebase-auth-proxy.js` 的内容完整粘贴进去并发布
3. 复制发布后的 Worker 地址（例如 `https://your-worker.workers.dev`）
4. 打开软件的「系统设置」
5. 在「网络中转配置」里填入这个地址并保存
6. 重启软件后生效

这个 Worker 只做两件事：
1. `POST /login` 转发到 Firebase `signInWithPassword`
2. `POST /` 转发到 Firebase `securetoken` 刷新接口

## 数据安全

- **本地存储**：所有账号数据存储在 `~/Library/Application Support/windsurf-tool/`（Mac）或 `%APPDATA%/windsurf-tool/`（Windows）
- **无远程服务器**：本工具没有自己的后端服务器，不会上传任何用户数据
- **开源透明**：所有代码公开，欢迎审查

## 代码审查

您可以自行审查以下关键文件，确认没有账号收集行为：

| 文件 | 说明 |
|------|------|
| `js/constants.js` | 所有外部 API 地址 |
| `js/accountLogin.js` | Token 获取逻辑 |
| `js/accountQuery.js` | 账号查询逻辑 |
| `main.js` | 主进程，搜索 `axios.post` 查看所有网络请求 |

## 免责声明
## 免责声明

本项目仅供学习和研究使用，不得用于商业用途。

- **风险自负**: 使用本工具所产生的一切后果由使用者自行承担
- **无担保**: 本项目按"原样"提供，不提供任何明示或暗示的担保
- **无关联**: 本项目与 Codeium / Windsurf 官方无任何关联
- **合规风险**: 使用本工具可能违反 Windsurf 的服务条款，请自行评估风险
- **维护声明**: 本项目已停止维护，不再提供更新和技术支持
- **数据安全**: 本工具不收集任何用户数据，所有账号信息仅存储在本地设备

使用本工具即表示您已阅读并同意上述条款。
## License

MIT License
