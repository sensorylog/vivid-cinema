import test from "node:test";
import assert from "node:assert/strict";
import { sortMediaItems } from "../scripts/media.js";

const item = (title, date, vote_average = 0) => ({ title, date, vote_average });

test("Newest sorts release dates descending, not by input/API order", () => {
  const input = [
    item("Older", "2022-03-01"),
    item("Newest", "2026-10-19"),
    item("Middle", "2024-06-12")
  ];
  assert.deepEqual(sortMediaItems(input, "primary_release_date.desc").map(x => x.title), [
    "Newest", "Middle", "Older"
  ]);
});

test("Newest keeps missing dates last and uses rating as a tie-breaker", () => {
  const input = [
    item("Undated", ""),
    item("Lower rated same day", "2026-10-19", 6),
    item("Higher rated same day", "2026-10-19", 8)
  ];
  assert.deepEqual(sortMediaItems(input, "primary_release_date.desc").map(x => x.title), [
    "Higher rated same day", "Lower rated same day", "Undated"
  ]);
});

test("Oldest sorts ascending but still keeps undated titles last", () => {
  const input = [
    item("Undated", ""),
    item("Later", "2024-01-01"),
    item("Earlier", "2010-01-01")
  ];
  assert.deepEqual(sortMediaItems(input, "primary_release_date.asc").map(x => x.title), [
    "Earlier", "Later", "Undated"
  ]);
});

test("TV first-air-date sort keys use the same normalized date values", () => {
  const input = [item("Later series", "2025-01-01"), item("Earlier series", "2020-01-01")];
  assert.deepEqual(sortMediaItems(input, "first_air_date.desc").map(x => x.title), [
    "Later series", "Earlier series"
  ]);
});
