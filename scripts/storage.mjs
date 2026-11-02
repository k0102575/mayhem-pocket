import path from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";

export function dataDirectory() {
  if (process.env.MAYHEM_DATA_DIR)
    return path.resolve(process.env.MAYHEM_DATA_DIR);
  let documents = path.join(homedir(), "Documents");
  if (process.platform === "win32") {
    documents = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; [Environment]::GetFolderPath('MyDocuments')",
      ],
      { encoding: "utf8", windowsHide: true },
    ).trim();
    if (!documents) throw Error("사용자 문서 폴더를 찾을 수 없습니다.");
  }
  return path.join(documents, "mayhem-pocket");
}
