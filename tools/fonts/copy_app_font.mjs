// Copy Inter (variable, latin subset; SIL OFL 1.1, see CREDITS.md) into the phone app, self-hosted so the PWA
// works offline and needs no third-party request.   cd tools && npm run app-font
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = dirname(createRequire(import.meta.url).resolve("@fontsource-variable/inter/package.json"));
const out = join(here, "../../backend/public/app/fonts");
mkdirSync(out, { recursive: true });
copyFileSync(join(pkg, "files/inter-latin-wght-normal.woff2"), join(out, "Inter-Variable.woff2"));
copyFileSync(join(pkg, "LICENSE"), join(out, "OFL.txt"));
console.log("Inter variable → backend/public/app/fonts/");
