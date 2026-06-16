// Unit tests for the typed-entity registry (run with `node --test`).
const test = require("node:test");
const assert = require("node:assert");
const E = require("../static/entities.js");

test("getEntityType returns a known type and null for unknown", () => {
    assert.strictEqual(E.getEntityType("domain").name, "Domain");
    assert.strictEqual(E.getEntityType("ipv4").shape, "rect");
    assert.strictEqual(E.getEntityType("does-not-exist"), null);
});

test("email value validation", () => {
    assert.strictEqual(E.validateEntityValue("email", "a@b.com"), null);
    assert.ok(E.validateEntityValue("email", "not-an-email"));
    assert.strictEqual(E.validateEntityValue("email", ""), null); // empty is allowed
});

test("ipv4 and domain validation", () => {
    assert.strictEqual(E.validateEntityValue("ipv4", "10.0.0.1"), null);
    assert.ok(E.validateEntityValue("ipv4", "999"));
    assert.strictEqual(E.validateEntityValue("domain", "evil.com"), null);
});

test("categories include Identity, Network, Infrastructure, Threat", () => {
    const cats = E.listEntityCategories();
    ["Identity", "Network", "Infrastructure", "Threat"].forEach(c => assert.ok(cats[c], "missing category " + c));
});

test("every entity type declares an id, name, shape and color", () => {
    E.listEntityTypes().forEach(t => {
        assert.ok(t.id && t.name && t.shape && t.color, "incomplete type: " + JSON.stringify(t));
    });
});
