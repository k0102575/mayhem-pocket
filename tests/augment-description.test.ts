import { test } from "node:test";
import assert from "node:assert/strict";
import { descriptionText } from "../src/augment-description";

test("augment descriptions retain text and line breaks without rendering provider markup", () => {
  assert.equal(
    descriptionText(
      "<scaleAF>적응형 능력치</scaleAF> &amp; 방어력<br><br><rules>최대 ?</rules>",
    ),
    "적응형 능력치 & 방어력\n\n최대 ?",
  );
  assert.equal(
    descriptionText(
      "<script>alert(1)</script><img src=x onerror=alert(1)>효과 &lt;예시&gt; &#37; &#x41;",
    ),
    "효과 <예시> % A",
  );
  assert.equal(descriptionText(null), "");
  assert.equal(descriptionText("  "), "");
});
