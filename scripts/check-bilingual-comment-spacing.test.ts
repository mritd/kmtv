import { describe, expect, test } from "bun:test";

import {
  analyzeSource,
  applyInsertionFix,
  isIncludedSourcePath,
} from "./check-bilingual-comment-spacing";

function fix(path: string, source: string): string {
  const analysis = analyzeSource(path, source);
  return applyInsertionFix(source, analysis.insertions);
}

describe("bilingual comment spacing", () => {
  test("inserts one matching separator between line-comment language sections", () => {
    const source = [
      "// Keep the later event.",
      "// Preserve source_key ordering.",
      "// 保留较晚的事件.",
      "// 保持 source_key 的顺序.",
      "const value = 1;",
      "",
    ].join("\n");

    const analysis = analyzeSource("web/src/example.ts", source);
    expect(analysis.findings).toEqual([
      expect.objectContaining({ line: 3, kind: "missing-separator" }),
    ]);
    expect(fix("web/src/example.ts", source)).toBe(
      [
        "// Keep the later event.",
        "// Preserve source_key ordering.",
        "//",
        "// 保留较晚的事件.",
        "// 保持 source_key 的顺序.",
        "const value = 1;",
        "",
      ].join("\n"),
    );
  });

  test("supports Swift documentation comments without detaching the declaration", () => {
    const source = [
      "/// Returns the cached value.",
      "/// 返回缓存值.",
      "func cachedValue() -> Int { 1 }",
      "",
    ].join("\n");

    expect(fix("apple/Shared/Cache.swift", source)).toBe(
      [
        "/// Returns the cached value.",
        "///",
        "/// 返回缓存值.",
        "func cachedValue() -> Int { 1 }",
        "",
      ].join("\n"),
    );
  });

  test("supports shell comments while leaving the shebang untouched", () => {
    const source = "#!/usr/bin/env bash\n# Explain the command.\n# 说明该命令.\necho ok\n";
    expect(fix("scripts/example.sh", source)).toBe(
      "#!/usr/bin/env bash\n# Explain the command.\n#\n# 说明该命令.\necho ok\n",
    );
  });

  test("keeps separators inside Go block comments, JSDoc, and JSX comments", () => {
    const fixtures = [
      {
        path: "server/example.go",
        source: "/*\n * English.\n * 中文.\n */\npackage example\n",
        expected: "/*\n * English.\n *\n * 中文.\n */\npackage example\n",
      },
      {
        path: "web/src/example.ts",
        source: "/**\n * English.\n * 中文.\n */\nexport const value = 1;\n",
        expected: "/**\n * English.\n *\n * 中文.\n */\nexport const value = 1;\n",
      },
      {
        path: "web/src/example.tsx",
        source: "{/*\n * English.\n * 中文.\n */}\n<div />\n",
        expected: "{/*\n * English.\n *\n * 中文.\n */}\n<div />\n",
      },
    ];

    for (const fixture of fixtures) {
      expect(fix(fixture.path, fixture.source)).toBe(fixture.expected);
    }
  });

  test("uses a whitespace-free separator inside unstarred JSX comments", () => {
    const source = [
      "      {/* English explanation.",
      "          \u4e2d\u6587\u8bf4\u660e. */}",
      "      <div />",
      "",
    ].join("\n");

    expect(fix("web/src/Example.tsx", source)).toBe(
      [
        "      {/* English explanation.",
        "",
        "          \u4e2d\u6587\u8bf4\u660e. */}",
        "      <div />",
        "",
      ].join("\n"),
    );
  });

  test("accepts exactly one existing separator and reports repeated separators", () => {
    const valid = "// English.\n//\n// 中文.\n";
    expect(analyzeSource("example.ts", valid).findings).toEqual([]);
    expect(fix("example.ts", valid)).toBe(valid);

    const repeated = "// English.\n//\n//\n// 中文.\n";
    expect(analyzeSource("example.ts", repeated).findings).toEqual([
      expect.objectContaining({ line: 3, kind: "extra-separator" }),
    ]);
    expect(fix("example.ts", repeated)).toBe(repeated);
  });

  test("reports reversed language order without fixing it", () => {
    const source = "// 中文.\n// English.\n";
    const analysis = analyzeSource("example.ts", source);
    expect(analysis.findings).toEqual([
      expect.objectContaining({ line: 2, kind: "reversed-order" }),
    ]);
    expect(applyInsertionFix(source, analysis.insertions)).toBe(source);
  });

  test("allows repeated English-Chinese paragraphs inside one long comment block", () => {
    const source = [
      "/**",
      " * First English paragraph.",
      " *",
      " * 第一段中文.",
      " *",
      " * Second English paragraph.",
      " *",
      " * 第二段中文.",
      " */",
      "",
    ].join("\n");

    expect(analyzeSource("web/src/example.ts", source).findings).toEqual([]);
    expect(fix("web/src/example.ts", source)).toBe(source);
  });

  test("inserts a paragraph separator before the next English section in a repeated bilingual block", () => {
    const source = [
      "// First English paragraph.",
      "//",
      "// 第一段中文.",
      "// Second English paragraph.",
      "//",
      "// 第二段中文.",
      "",
    ].join("\n");

    const expected = [
      "// First English paragraph.",
      "//",
      "// 第一段中文.",
      "//",
      "// Second English paragraph.",
      "//",
      "// 第二段中文.",
      "",
    ].join("\n");

    expect(fix("web/src/example.ts", source)).toBe(expected);
  });

  test("requires exactly one matching separator before a repeated English section", () => {
    const repeated = [
      "// First English paragraph.",
      "//",
      "// \u7b2c\u4e00\u6bb5\u4e2d\u6587.",
      "//",
      "//",
      "// Second English paragraph.",
      "//",
      "// \u7b2c\u4e8c\u6bb5\u4e2d\u6587.",
      "",
    ].join("\n");
    expect(analyzeSource("web/src/example.ts", repeated).findings).toEqual([
      expect.objectContaining({ line: 5, kind: "extra-separator" }),
    ]);

    const mismatched = [
      "// First English paragraph.",
      "//",
      "// \u7b2c\u4e00\u6bb5\u4e2d\u6587.",
      "///",
      "// Second English paragraph.",
      "//",
      "// \u7b2c\u4e8c\u6bb5\u4e2d\u6587.",
      "",
    ].join("\n");
    expect(analyzeSource("web/src/example.ts", mismatched).findings).toEqual([
      expect.objectContaining({ line: 4, kind: "mismatched-separator" }),
    ]);
  });

  test("ignores inline bilingual labels instead of treating them as Chinese sections", () => {
    const source = [
      "/**",
      " * App — thin entry point.",
      " *",
      " * App — 轻量入口.",
      " *",
      " * Responsibilities / 职责:",
      " *   - Mount AppShell.",
      " *",
      " *     挂载 AppShell.",
      " *",
      " * Callers / 调用方:",
      " *   main.tsx",
      " */",
      "",
    ].join("\n");

    expect(analyzeSource("web/src/example.tsx", source).findings).toEqual([]);
    expect(fix("web/src/example.tsx", source)).toBe(source);
  });

  test("treats a Han line containing Latin identifiers as Chinese", () => {
    const source = "// Keep source_key stable.\n// 保持 source_key 和 video_id 稳定.\n";
    expect(fix("example.ts", source)).toBe(
      "// Keep source_key stable.\n//\n// 保持 source_key 和 video_id 稳定.\n",
    );
  });

  test("classifies quoted or parenthesized CJK examples by the surrounding prose", () => {
    const source = [
      "// The heading \"选集\" used to be hardcoded.",
      "// The default theme is Nocturne Blue (夜曲蓝).",
      "//",
      "// \"选集\" 标题此前是硬编码.",
      "// 默认主题是夜曲蓝 (Nocturne Blue).",
      "",
    ].join("\n");

    expect(analyzeSource("web/src/example.test.ts", source).findings).toEqual([]);
    expect(fix("web/src/example.test.ts", source)).toBe(source);
  });

  test("keeps parenthesized Chinese continuation lines in the Chinese section", () => {
    const source = [
      "// The function always returns string.",
      "//",
      "// 返回类型推断为 string",
      "// (由于 returnNull: false, 永不返回 null).",
      "",
    ].join("\n");

    expect(analyzeSource("web/src/i18next.d.ts", source).findings).toEqual([]);
    expect(fix("web/src/i18next.d.ts", source)).toBe(source);
  });

  test("does not inspect shebangs, directive runs, shell heredocs, or non-comment text", () => {
    const fixtures = [
      "#!/usr/bin/env bash\necho 'English 中文'\n",
      "// @ts-expect-error -- English 中文\n",
      "//go:embed English中文\n",
      "/* istanbul ignore next -- English 中文 */\nconst text = '// English. // 中文.';\n",
      "const url = 'https://example.com/English/中文';\n",
      "const template = `\n// English.\n// 中文.\n`;\n",
      "const value = 1; /*\n// English.\n// 中文.\n*/\n",
      "cat <<'EOF'\n# English.\n# 中文.\nEOF\n",
      "cat <<\\EOF\n# English.\n# 中文.\nEOF\n",
      "cat <<END-MARK\n# English.\n# 中文.\nEND-MARK\n",
    ];

    for (const [index, source] of fixtures.entries()) {
      const path = source.includes("cat <<") ? `fixture-${index}.sh` : `fixture-${index}.ts`;
      expect(analyzeSource(path, source).findings).toEqual([]);
      expect(fix(path, source)).toBe(source);
    }
  });

  test("keeps directive comments from hiding adjacent ordinary bilingual comments", () => {
    const source = [
      "// @ts-expect-error -- intentionally narrows the mock.",
      "// Keep the fallback stable.",
      "// 保持兜底逻辑稳定.",
      "mock();",
      "",
    ].join("\n");

    expect(fix("web/src/example.test.ts", source)).toBe(
      [
        "// @ts-expect-error -- intentionally narrows the mock.",
        "// Keep the fallback stable.",
        "//",
        "// 保持兜底逻辑稳定.",
        "mock();",
        "",
      ].join("\n"),
    );
  });

  test("closes shell heredocs before scanning later ordinary comments", () => {
    const source = "cat <<END-MARK\n# payload English.\n# payload 中文.\nEND-MARK\n# Real English.\n# 真实中文.\n";
    expect(fix("scripts/example.sh", source)).toBe(
      "cat <<END-MARK\n# payload English.\n# payload 中文.\nEND-MARK\n# Real English.\n#\n# 真实中文.\n",
    );
  });

  test("treats hash-prefixed source as comments only in shell files", () => {
    const typescript = "class Example {\n  #english = 1;\n  #\u4e2d\u6587 = 2;\n}\n";
    const swift = '#if DEBUG\n#warning("English")\n#warning("\u4e2d\u6587")\n#endif\n';

    for (const [path, source] of [
      ["web/src/Example.ts", typescript],
      ["apple/Shared/Example.swift", swift],
    ]) {
      expect(analyzeSource(path, source).findings).toEqual([]);
      expect(fix(path, source)).toBe(source);
    }
  });

  test("reports a mismatched separator marker without rewriting it", () => {
    const source = "// English.\n///\n// 中文.\n";
    const analysis = analyzeSource("example.ts", source);
    expect(analysis.findings).toEqual([
      expect.objectContaining({ line: 2, kind: "mismatched-separator" }),
    ]);
    expect(applyInsertionFix(source, analysis.insertions)).toBe(source);
  });

  test("preserves every original byte and is idempotent", () => {
    const source = "// English.\r\n// 中文.";
    const first = fix("example.ts", source);
    const second = fix("example.ts", first);

    expect(first).toBe("// English.\r\n//\r\n// 中文.");
    expect(second).toBe(first);
    expect(first.replace("//\r\n", "")).toBe(source);
  });
});

describe("repository source discovery policy", () => {
  test("includes every authored source extension", () => {
    for (const path of [
      "server/main.go",
      "web/vite.config.ts",
      "web/src/App.tsx",
      "scripts/check.js",
      "apple/Shared/Model.swift",
      "scripts/device.sh",
    ]) {
      expect(isIncludedSourcePath(path)).toBe(true);
    }
  });

  test("uses the exact generated, vendored, and locale exclusions", () => {
    for (const path of [
      "../outside.ts",
      "../../tmp/outside.ts",
      "/tmp/outside.ts",
      "web/node_modules/pkg/index.ts",
      "web/dist/app.js",
      "server/web/dist/app.js",
      "apple/.build/check.swift",
      "apple/DerivedData/check.swift",
      "apple/KMTV.xcodeproj/project.ts",
      "apple/KMTV.xcworkspace/check.swift",
      "web/src/i18n/locales/zh.ts",
      "android/src/i18n/locales/en.ts",
      "image.png",
    ]) {
      expect(isIncludedSourcePath(path)).toBe(false);
    }
  });
});
