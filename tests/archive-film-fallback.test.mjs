import test from "node:test";
import assert from "node:assert/strict";
import { licenseFor, hasPlayableVideo, acceptedLicense } from "../scripts/playback/archive-film-fallback.js";

test("Archive Cinema accepts public-domain and commercial Creative Commons declarations", () => {
  assert.equal(licenseFor({ licenseurl: "https://creativecommons.org/publicdomain/mark/1.0/" }), "Public-domain declaration");
  assert.equal(licenseFor({ licenseurl: "https://creativecommons.org/publicdomain/zero/1.0/" }), "Public-domain declaration");
  assert.equal(licenseFor({ licenseurl: "https://creativecommons.org/licenses/by/4.0/" }), "CC BY · attribution");
  assert.equal(licenseFor({ licenseurl: "https://creativecommons.org/licenses/by-sa/4.0/" }), "CC BY-SA · attribution/share-alike");
});

test("Archive Cinema rejects non-commercial, no-derivatives and undeclared rights", () => {
  assert.equal(licenseFor({ licenseurl: "https://creativecommons.org/licenses/by-nc/4.0/", rights: "Public domain" }), null);
  assert.equal(licenseFor({ licenseurl: "https://creativecommons.org/licenses/by-nd/4.0/" }), null);
  assert.equal(licenseFor({ licenseurl: "https://creativecommons.org/licenses/by-nc-sa/4.0/", rights: "Public domain" }), null);
  assert.equal(licenseFor({ licenseurl: "https://creativecommons.org/licenses/by-nd-sa/4.0/", rights: "Public domain" }), null);
  assert.equal(licenseFor({ licenseurl: "", rights: "All rights reserved" }), null);
  assert.equal(licenseFor({}), null);
});

test("Archive Cinema only offers records with a browser-playable video file", () => {
  assert.equal(hasPlayableVideo([{ name: "film.mp4", format: "MPEG4" }]), true);
  assert.equal(hasPlayableVideo([{ name: "film.mkv", format: "Matroska" }]), false);
  assert.equal(hasPlayableVideo([{ name: "film.mp4", format: "MPEG4", private: true }]), false);
  assert.equal(hasPlayableVideo([{ name: "notes.txt", format: "Text" }]), false);
});


test("Wikimedia and Library of Congress sources require an explicit compatible rights notice", () => {
  assert.equal(acceptedLicense("Public domain"), "Public domain");
  assert.equal(acceptedLicense("CC BY-SA 4.0"), "CC BY-SA 4.0");
  assert.match(acceptedLicense("No known restrictions on publication"), /No known restrictions advisory/);
  assert.equal(acceptedLicense("All rights reserved"), "");
  assert.equal(acceptedLicense("Rights status not evaluated"), "");
  assert.equal(acceptedLicense("CC BY-NC 4.0"), "");
});
