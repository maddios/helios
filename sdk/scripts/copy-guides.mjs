import { cpSync, rmSync } from "node:fs";

const source = new URL("../../docs/guides", import.meta.url);
const target = new URL("../guides", import.meta.url);

rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });
