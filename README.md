# 数采管理平台（独立站点，Vue 3 + TypeScript + Ant Design Vue）

自带登录页，可单独运行，也可从「具身智能训练场」入口站一键跳转进入。

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # 类型检查 + 打包
```

## 登录
- 登录页 `/#/login`。演示账号（密码均为 `123456`）：`admin` 系统管理员 / `zhangjie` 采集操作员 / `linyue` 标注员 / `chenjing` 审核员 / `zhaogong` 维护工程师。
- 登录态在 `src/stores/session.ts`，对接真实后端时替换 `login()`。

## 与入口站互跳
- 入口站点击「数据采集」会打开 `http://localhost:5173/#/login?sso=<角色>`，本站读取 `sso` 直接登录（演示用，正式环境请改为后端签发的 token 校验），并清掉地址里的参数。
- 本站顶栏的「全部模块」与用户菜单的「返回训练场入口」跳回入口站，地址在 `.env` 的 `VITE_PORTAL_URL`；留空则不显示。
- 部署到服务器时，把 `VITE_PORTAL_URL` 改成入口站的实际地址后重新打包。

## 说明
- 数据为前端 mock，页面与交互与上一版一致；8 处业务改动（设备分配场景、任务向导选设备、自检与自动质检、流水线、手动标注与审核）均已包含。
