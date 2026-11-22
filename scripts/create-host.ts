import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { resolve } from "node:path";
import { Store } from "../server/store.js";
const io = createInterface({ input: stdin, output: stdout });
try {
  const login =
    process.env.HOST_LOGIN === undefined
      ? await io.question("主持登录名：")
      : process.env.HOST_LOGIN;
  const password =
    process.env.HOST_PASSWORD === undefined
      ? await io.question("主持密码（至少 10 字符，输入会回显）：")
      : process.env.HOST_PASSWORD;
  const dataDir = process.env.DATA_DIR;
  if (dataDir !== undefined && dataDir.trim().length === 0) throw new Error("DATA_DIR不能为空");
  const store = new Store(dataDir === undefined ? resolve("data") : resolve(dataDir));
  try {
    store.createHost(login, password);
  } finally {
    store.close();
  }
  console.log("主持账号已创建");
} finally {
  io.close();
}
