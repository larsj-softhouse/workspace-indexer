import { describe, it, expect } from "vitest";
import { parseTsFile } from "../src/parser/ts-parser.js";
import { parseVueFile } from "../src/parser/vue-parser.js";

describe("TS/JS AST Parser", () => {
  it("should extract named exports", () => {
    const code = `
      export function foo() {}
      export const bar = 1;
      export class Baz {}
    `;
    const exports = parseTsFile("test.ts", code);
    expect(exports).toContain("foo");
    expect(exports).toContain("bar");
    expect(exports).toContain("Baz");
  });

  it("should extract default exports and infer their names", () => {
    const code1 = `
      export default class MyComponent {}
    `;
    const exports1 = parseTsFile("test1.ts", code1);
    expect(exports1).toContain("default");
    expect(exports1).toContain("MyComponent");

    const code2 = `
      function someFunc() {}
      export default someFunc;
    `;
    const exports2 = parseTsFile("test2.ts", code2);
    expect(exports2).toContain("default");
    expect(exports2).toContain("someFunc");
  });

  it("should handle variable declarations with multiple variables", () => {
    const code = `
      export const a = 1, b = 2;
    `;
    const exports = parseTsFile("test.ts", code);
    expect(exports).toContain("a");
    expect(exports).toContain("b");
  });
});

describe("Vue SFC Parser", () => {
  it("should extract component name from filename and standard exports from script tags", () => {
    const vueCode = `
      <template>
        <div>Hello</div>
      </template>
      <script lang="ts">
        export const hello = "world";
        export default {
          name: "TestComponent"
        }
      </script>
    `;
    // The component name is derived from the file path, e.g. /path/to/Button.vue -> Button
    const exports = parseVueFile("/workspace/Button.vue", vueCode);
    expect(exports).toContain("Button");
    expect(exports).toContain("default");
    expect(exports).toContain("hello");
  });

  it("should support script setup block", () => {
    const vueCode = `
      <script setup lang="ts">
        import { ref } from "vue";
        const msg = ref("Hello!");
        defineProps<{ title: string }>();
      </script>
    `;
    const exports = parseVueFile("/workspace/Header.vue", vueCode);
    expect(exports).toContain("Header");
    expect(exports).toContain("default");
  });

  it("should support both script and script setup blocks simultaneously", () => {
    const vueCode = `
      <script lang="ts">
        export const myExport = 42;
      </script>
      <script setup lang="ts">
        const x = 1;
      </script>
    `;
    const exports = parseVueFile("/workspace/Sidebar.vue", vueCode);
    expect(exports).toContain("Sidebar");
    expect(exports).toContain("default");
    expect(exports).toContain("myExport");
  });
});
