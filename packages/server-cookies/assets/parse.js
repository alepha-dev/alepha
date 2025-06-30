import { inflateRawSync } from "node:zlib";

const tokens = ""

const {access_token} = JSON.parse(inflateRawSync(Buffer.from(tokens, "base64"), { to: "string" }))
const payload = JSON.parse(Buffer.from(access_token.split(".")[1], "base64").toString())

console.log(payload)
