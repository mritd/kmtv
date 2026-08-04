// @ts-expect-error Vitest runs this file in Node, while the app tsconfig stays browser-only.
import { readdirSync, readFileSync, statSync } from "node:fs";
// @ts-expect-error Same as above — node:path is not in the browser lib set.
import { join, relative, resolve } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

// Why an AST walk rather than a regex over the raw text: the file set is full of bilingual
// comments that legitimately contain CJK, and stripping them textually is unreliable — a
// "https://" inside a string literal looks exactly like a line comment to a regex, so the
// naive version deletes real code and reports nothing. Parsing gives the comment/literal
// distinction for free, and a literal is exactly what a hardcoded label is.
// 为什么用 AST 遍历而非对原文做正则: 这些文件里满是合法包含 CJK 的双语注释,
// 而用文本方式剥离注释并不可靠 — 字符串字面量中的 "https://" 在正则看来与行注释无异,
// 于是朴素版本会删掉真实代码并漏报一切.
// 解析可以免费得到注释与字面量的区分, 而字面量正是硬编码文案的形态.

// Resolved from the working directory rather than __dirname, which the browser-only app
// tsconfig does not declare; vitest runs from web/, the same assumption style.test.ts makes.
// 以工作目录而非 __dirname 解析, 因为面向浏览器的 app tsconfig 未声明后者;
// vitest 从 web/ 运行, 与 style.test.ts 的假设一致.
const SRC = resolve("src");
const CJK = /[一-鿿]/;

// Locales are the one place user-facing Chinese belongs. Tests are excluded because their
// assertions quote the very strings the app renders.
// 语言资源是用户可见中文唯一该待的地方. 测试被排除, 因为其断言正是在引用应用渲染的文案.
const EXCLUDED_DIRS = new Set(["locales", "__tests__"]);
const EXCLUDED_SUFFIXES = [".test.ts", ".test.tsx", ".d.ts"];

/**
 * Files whose CJK literals are known not to reach the screen. Deliberately empty: the two
 * entries this list was created with (shared/format.ts and admin/forms/editableSettingsSchema.ts)
 * were retired by deleting the dead literals instead of grandfathering them. Add an entry only
 * with a reason that survives being read aloud, and delete it as soon as the code is fixed.
 * 已知其 CJK 字面量不会显示到界面的文件. 刻意保持为空: 该清单创建时的两个条目
 * (shared/format.ts 与 admin/forms/editableSettingsSchema.ts) 都是通过删除死字面量了结的,
 * 而非就地豁免. 仅在理由经得起当众念出来时才添加条目, 并在代码修好后立刻删除.
 */
const KNOWN_DEAD_LITERALS: Record<string, string> = {};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry)) walk(full, out);
    } else if ((full.endsWith(".ts") || full.endsWith(".tsx")) && !EXCLUDED_SUFFIXES.some((s) => full.endsWith(s))) {
      out.push(full);
    }
  }
  return out;
}

interface Finding {
  file: string;
  line: number;
  text: string;
}

function findCJKLiterals(file: string): Finding[] {
  const source = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const findings: Finding[] = [];

  const record = (node: ts.Node, text: string) => {
    if (!CJK.test(text)) return;
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    findings.push({ file: relative(SRC, file), line: line + 1, text: text.trim().slice(0, 40) });
  };

  const visit = (node: ts.Node) => {
    // JSX text is the ">选集<" case; string and template literals cover props, aria-labels
    // and every `const label = "..."`. Template *spans* are checked piecewise because
    // `播放 ${name}` splits into a head and an expression.
    // JSX 文本对应 ">选集<" 的情形; 字符串与模板字面量覆盖 props, aria-label
    // 以及所有 `const label = "..."`. 模板的各段分别检查, 因为
    // `播放 ${name}` 会拆成 head 与表达式两部分.
    if (ts.isJsxText(node)) record(node, node.text);
    else if (ts.isStringLiteral(node)) record(node, node.text);
    else if (ts.isNoSubstitutionTemplateLiteral(node)) record(node, node.text);
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) record(node, node.text);
    node.forEachChild(visit);
  };
  visit(sf);
  return findings;
}

describe("i18n hardcoding", () => {
  it("routes every user-facing string through a locale file", () => {
    const offenders = walk(SRC)
      .flatMap(findCJKLiterals)
      .filter((f) => !(f.file in KNOWN_DEAD_LITERALS));

    // The heading "选集" sat hardcoded in EpisodePicker.tsx from the first implementation and
    // survived every review and both existing i18n checks, because those compare locale files
    // to each other and never look at the source. It took someone noticing it on screen.
    // "选集" 标题自首次实现起就硬编码在 EpisodePicker.tsx 中, 躲过了每一次评审与两个既有
    // i18n 检查 — 因为那些检查只把语言文件互相比对, 从不查看源码.
    // 最终是靠人眼在界面上发现的.
    expect(offenders.map((f) => `${f.file}:${f.line}  ${f.text}`)).toStrictEqual([]);
  });

  it("keeps the dead-literal exemptions honest", () => {
    // An exemption that no longer has CJK in it is stale — drop it from the list so the next
    // hardcoded string in that file is caught rather than silently waved through.
    // 若某个豁免文件已不含 CJK, 该豁免即已过期 — 应从清单移除,
    // 否则该文件中下一个硬编码字符串会被悄悄放行.
    for (const [file, reason] of Object.entries(KNOWN_DEAD_LITERALS)) {
      expect(findCJKLiterals(join(SRC, file)).length, `${file} is exempt for "${reason}" but has no CJK left`)
        .toBeGreaterThan(0);
    }
  });
});
