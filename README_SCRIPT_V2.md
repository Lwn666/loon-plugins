# Loon Script v2 新语法迁移说明

本仓库插件已迁移到 **Script v2 新语法**（Loon 3.5.1 (983)+）。旧语法仍可作为输入兼容，但新建/编辑/保存统一输出新语法。

## 语法对照

```text
# HTTP
旧: http-response ^正则 script-path=x.js,requires-body=true,argument="a",timeout=30,tag=T
新: response if ${url} ~= /正则/i then script("x.js", "a") with tag="T", timeout=30, requires_body=true

# Cron（cron 后面直接跟表达式，不再写 script-path=）
旧: cron "0 8 * * *" script-path=x.js,tag=T,timeout=30
新: cron "0 8 * * *" then script("x.js") with tag="T", timeout=30

# Network Changed / Generic
旧: network-changed script-path=x.js,argument={a},tag=T
新: network-changed then script("x.js", {${a}}) with tag="T"
旧: generic script-path=x.js,img-url=tool.system,tag=T
新: generic then script("x.js") with tag="T", img_url="tool.system"
```

## 关键约束

| 约束 | 说明 |
|---|---|
| Response URL Guard | 必须含 `${url}` 条件且为必要条件（`&&` 连接），`url~=/a/ \|\| status==500` 无效 |
| 脚本路径 | 固定字符串，不能用变量/模板；一条规则只能一个 `script(...)`，无 `\|` 管道 |
| `with` 字段 | snake_case、区分大小写、不可重复；未知字段致整条规则无效 |
| `$argument` | 省略→null；String/Raw String→String；`{${a}, ${b}}`→Object（仅插件） |
| 条件操作符 | 仅 `==` `~=` `&&` `\|\|` `()`；不支持 `!=` `!~` 逻辑非 大小比较 Body 条件 `as` 捕获 |

## 本地校验

```bash
python3 script_v2_convert.py lint <plugin文件>
python3 script_v2_convert.py convert <旧语法文件> --full > <新语法文件>
```

转换器/校验器源码：见 Minis loon 技能 `scripts/script_v2_convert.py`。
