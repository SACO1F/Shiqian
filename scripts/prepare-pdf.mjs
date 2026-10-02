import { cpSync, mkdirSync } from "node:fs";
for (const directory of ["cmaps", "standard_fonts", "wasm"]) {
  mkdirSync("public/pdf-assets", { recursive: true });
  cpSync(
    `node_modules/pdfjs-dist/${directory}`,
    `public/pdf-assets/${directory}`,
    { recursive: true },
  );
}
