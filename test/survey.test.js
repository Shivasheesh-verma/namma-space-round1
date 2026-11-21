// node --test test/survey.test.js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { LayoutCollider } from "../src/collision.js";

const read = (name) => JSON.parse(readFileSync(new URL(name, import.meta.url)));
const survey = new LayoutCollider(read("fixtures/survey_out/collision.json"));
survey.setFurniture(read("fixtures/survey_out/plan.json"));
const october = new LayoutCollider(read("../oct27/collision.json"));
october.setFurniture(read("../oct27/plan.json"));

test("a point 0.3 m outside a survey wall is not occupiable", () => {
  assert.equal(survey.canOccupy(-0.3, 3), false);
});

test("the middle of the surveyed room is free, a desk blocks, a step does not", () => {
  assert.equal(survey.canOccupy(2, 1.5), true);
  assert.equal(survey.canOccupy(2, 3), false);
  assert.equal(survey.canOccupy(1, 1), true);
});

test("the old corridor speck is occupiable", () => {
  assert.equal(october.canOccupy(-1.1, -10.85), true);
});
