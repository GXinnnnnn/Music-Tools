# Text tools

`source/core/text-tools.cjs` is a synchronous CommonJS module with no npm runtime dependencies or network calls. All functions return new values; tag utilities return patches containing only changed fields (except `clearTags`, which deliberately returns empty-string fields).

## Public APIs

```js
const {
  tagsFromFilename, cleanLyrics, replaceTags, clearTags,
  convertChinese, convertTags, layoutLyrics
} = require('./source/core/text-tools.cjs');
```

- `tagsFromFilename(filename, template = '{artist} - {title}', regex = false) -> object`: accepts Windows/POSIX paths and removes recognized audio extensions. Literal templates support `{title}`, `{artist}`, `{album}`, `{albumArtist}`, `{track}`, `{disc}`, `{year}`, `{comment}`. Regex mode accepts named captures and placeholders. Matching is anchored; unsupported/repeated placeholders, invalid regex, mismatches and blank captures throw. Regex mode is intended for trusted local templates.
- `replaceTags(tags, {find, replace = '', fields = Object.keys(tags), regex = false, caseSensitive = false}) -> patch`: replaces all matches in strings and string array entries. Literal mode treats replacement dollar signs literally; regex mode supports JavaScript replacement captures. Missing/non-text fields are preserved. Empty `find` and invalid regex throw.
- `clearTags(fields) -> patch`: deduplicates explicit field names and sets each to `''`. Dangerous prototype-related field names are rejected by all field-selection APIs.
- `cleanLyrics(text, options = {}) -> string`: normalizes CRLF/CR to LF. Options: `stripTimes`, `stripMetadata`, `removeBlank`, `offsetMs = 0`, `formatTimes`. Timestamp transformations apply the last `[offset:...]` header exactly once, remove offset headers, support repeated and hour timestamps, clamp negative times to zero and render `[mm:ss.mmm]`. Metadata and timestamps otherwise remain intact. `offsetMs` must be finite; timestamp transformations reject values outside JavaScript's safe integer millisecond range. Optional `translatedLyrics`, `layout`, `separator`, `translationOffsetMs` delegate to `layoutLyrics` before cleanup; passing translations without a layout defaults to `interleaved`.
- `convertChinese(text, {from = 'cn', to = 'tw'} = {}) -> string`: offline OpenCC conversion with phrase disambiguation. Locale codes: `cn` simplified Chinese, `t` generic traditional, `tw` Taiwan characters, `twp` Taiwan characters and vocabulary, `hk` Hong Kong characters, `jp` Japanese Shinjitai. Explicitly set `from` for regional reverse conversion. Unknown locales throw, including on empty input. Converters are built lazily and cached by locale pair. Latin text, emoji and LRC syntax survive conversion; shared Chinese/Japanese characters follow the explicitly chosen locale.
- `convertTags(tags, {from = 'cn', to = 'tw', fields = Object.keys(tags)} = {}) -> patch`: applies the same Chinese conversion to selected string fields and string array elements, preserving numbers and other values. Only changed fields are returned; source objects and arrays are never modified.
- `layoutLyrics(original, translated = '', {layout = 'interleaved', separator = ' / ', offsetMs = 0, translationOffsetMs = 0} = {}) -> string`: formats supplied translations; it does not translate text. Layouts are `original`, `translation`, `interleaved` (original then translation on separate lines), and `inline` (joined using `separator`). Timed lyrics align by exact millisecond timestamp after each input's offset header and explicit offsets. Repeated timestamp prefixes expand to individual events; output events are chronological. Duplicate text and unmatched events are retained. Original metadata is retained; translation metadata is excluded in combined layouts. Untimed notes are retained ahead of timed events. Two plain texts align by line index, including empty lines. A timed/plain mixture throws rather than inventing timing. Empty translation falls back to the original. Offsets must be finite and separators cannot contain line breaks.

## Examples

```js
convertChinese('音乐与头发，后台开发', {from: 'cn', to: 'tw'});
convertTags({title: '音樂', artist: ['龍', 'Singer'], year: 2024}, {
  from: 'tw', to: 'cn', fields: ['title', 'artist']
});
layoutLyrics('[00:01]Hello', '[00:01]你好', {layout: 'inline'});
// '[00:01.000]Hello / 你好'
cleanLyrics('[00:01]Hello', {
  translatedLyrics: '[00:01]你好', layout: 'interleaved', stripTimes: true
});
// 'Hello\n你好'
```

## Integration contract and review findings

The integrated main-process `text-tools` handler dispatches `filename`, `replace`, `lyrics`, `chinese` and `clear`. Chinese controls call `convertTags(item.tags, options)` to produce a selected-field draft. Lyrics controls support supplied translation text and all four layouts through `cleanLyrics`; the online candidate review also exposes layout selection when the provider returns `translatedLyrics`.

Integration review findings were resolved: online translations can be staged with a selected layout; Chinese conversion is available in the tool panel; rename restoration returns the previous path, removes stale queue/draft/selection references and registers the restored path in the main-process allowlist. Settings JSON is parsed defensively and source/options values are normalized. Real Electron tests cover conversion drafts, rename/restore byte hashes, stale-path removal, lyrics cleanup and all-row disk/UI refresh.

## Validation

Run `node --test tests/text-tools.test.cjs`. Tests cover original filename parsing, replacement, explicit clearing, LRC offsets/timing, phrase-aware conversion in both directions and regional variants, immutability, multilingual preservation, translation alignment, missing rows and input validation. No test requires network or installed npm packages.

## Vendored OpenCC provenance and licenses

The complete unmodified `opencc-js@1.4.2` UMD bundle is embedded in `text-tools.cjs` inside a lazily called function. This avoids additional owned files, runtime dependency resolution, dynamic code evaluation and network access. The npm tarball was verified against pinned npm SRI `sha512-EdcspgdROiCCZDM+jZR6Pa670xW+EW2QhctPBQ8gRjg6lrx4IHEl+2s+kt5izk/TkxVRgdWuFgaGkaEdIUfdaw==` before embedding. The original bundle is 1,195,473 bytes. Upstream: https://github.com/nk2028/opencc-js ; package: https://www.npmjs.com/package/opencc-js/v/1.4.2 . Preserve the embedded MIT and Apache notices when redistributing this source. To update, inspect the pinned npm release, verify its tarball SRI, replace only the vendor block and update version, integrity, license notices and conversion tests together.

The complete upstream notices follow, and are also embedded in the shipped core module so packaged applications retain them.

MIT License

Copyright (c) 2020-2021 The nk2028 Project

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

# Third-Party Licenses

This document lists third-party software whose data or code is incorporated into
`opencc-js` and describes the associated license obligations.

---

## opencc-data

- **Package**: [`opencc-data`](https://www.npmjs.com/package/opencc-data)
- **Repository**: <https://github.com/nk2028/opencc-data>
- **License**: Apache License, Version 2.0

Dictionary data distributed with `opencc-js` is generated at build time from the
source files provided by the `opencc-data` package.  The generated data is
therefore a derivative work of `opencc-data` and is redistributed under the
terms of the Apache License, Version 2.0.

A copy of the Apache License, Version 2.0 is reproduced below.

```
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship made available under
      the License, as indicated by a copyright notice that is included
      in or attached to the work (an example is provided in the Appendix
      below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and derivative works thereof.

      "Contribution" shall mean, as submitted to the Licensor for inclusion
      in the Work by the copyright owner or by an individual or Legal Entity
      authorized to submit on behalf of the copyright owner. For the purposes
      of this definition, "submitted" means any form of electronic, verbal,
      or written communication sent to the Licensor or its representatives,
      including but not limited to communication on electronic mailing lists,
      source code control systems, and issue tracking systems that are managed
      by, or on behalf of, the Licensor for the purpose of discussing and
      improving the Work, but excluding communication that is conspicuously
      marked or designated in writing by the copyright owner as "Not a
      Contribution."

      "Contributor" shall mean Licensor and any Legal Entity on behalf of
      whom a Contribution has been received by the Licensor and included
      within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by the combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a cross-claim
      or counterclaim in a lawsuit) alleging that the Work or any
      Contribution embodied within the Work constitutes direct or contributory
      patent infringement, then any patent licenses granted to You under
      this License for that Work shall terminate as of the date such
      litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or Derivative Works
          a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, You must include a readable copy of the
          attribution notices contained within such NOTICE file, in
          at least one of the following places: within a NOTICE text
          file distributed as part of the Derivative Works; within
          the Source form or documentation, if provided along with the
          Derivative Works; or, within a display generated by the
          Derivative Works, if and wherever such third-party notices
          normally appear. The contents of the NOTICE file are for
          informational purposes only and do not modify the License.
          You may add Your own attribution notices within Derivative
          Works that You distribute, alongside or in addition to the
          NOTICE text from the Work, provided that such additional
          attribution notices cannot be construed as modifying the
          License.

      You may add Your own license statement for Your modifications and
      may provide additional grant of rights to use, copy, modify, merge,
      publish, distribute, sublicense, and/or sell copies of the
      Derivative Works, subject to the terms of this License for the
      Work itself.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any conditions of TITLE,
      NONINFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A PARTICULAR
      PURPOSE. You are solely responsible for determining the
      appropriateness of using or reproducing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or exemplary damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or all other
      commercial damages or losses), even if such Contributor has been
      advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may offer only
      conditions consistent with this License, and charge a fee for,
      acceptance of support, warranty, indemnity, or other liability
      obligations and/or rights consistent with this License.

   END OF TERMS AND CONDITIONS
```

Apache License
Version 2.0, January 2004
http://www.apache.org/licenses/

TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

1. Definitions.

"License" shall mean the terms and conditions for use, reproduction, and distribution as defined by Sections 1 through 9 of this document.

"Licensor" shall mean the copyright owner or entity authorized by the copyright owner that is granting the License.

"Legal Entity" shall mean the union of the acting entity and all other entities that control, are controlled by, or are under common control with that entity. For the purposes of this definition, "control" means (i) the power, direct or indirect, to cause the direction or management of such entity, whether by contract or otherwise, or (ii) ownership of fifty percent (50%) or more of the outstanding shares, or (iii) beneficial ownership of such entity.

"You" (or "Your") shall mean an individual or Legal Entity exercising permissions granted by this License.

"Source" form shall mean the preferred form for making modifications, including but not limited to software source code, documentation source, and configuration files.

"Object" form shall mean any form resulting from mechanical transformation or translation of a Source form, including but not limited to compiled object code, generated documentation, and conversions to other media types.

"Work" shall mean the work of authorship, whether in Source or Object form, made available under the License, as indicated by a copyright notice that is included in or attached to the work (an example is provided in the Appendix below).

"Derivative Works" shall mean any work, whether in Source or Object form, that is based on (or derived from) the Work and for which the editorial revisions, annotations, elaborations, or other modifications represent, as a whole, an original work of authorship. For the purposes of this License, Derivative Works shall not include works that remain separable from, or merely link (or bind by name) to the interfaces of, the Work and Derivative Works thereof.

"Contribution" shall mean any work of authorship, including the original version of the Work and any modifications or additions to that Work or Derivative Works thereof, that is intentionally submitted to Licensor for inclusion in the Work by the copyright owner or by an individual or Legal Entity authorized to submit on behalf of the copyright owner. For the purposes of this definition, "submitted" means any form of electronic, verbal, or written communication sent to the Licensor or its representatives, including but not limited to communication on electronic mailing lists, source code control systems, and issue tracking systems that are managed by, or on behalf of, the Licensor for the purpose of discussing and improving the Work, but excluding communication that is conspicuously marked or otherwise designated in writing by the copyright owner as "Not a Contribution."

"Contributor" shall mean Licensor and any individual or Legal Entity on behalf of whom a Contribution has been received by Licensor and subsequently incorporated within the Work.

2. Grant of Copyright License. Subject to the terms and conditions of this License, each Contributor hereby grants to You a perpetual, worldwide, non-exclusive, no-charge, royalty-free, irrevocable copyright license to reproduce, prepare Derivative Works of, publicly display, publicly perform, sublicense, and distribute the Work and such Derivative Works in Source or Object form.

3. Grant of Patent License. Subject to the terms and conditions of this License, each Contributor hereby grants to You a perpetual, worldwide, non-exclusive, no-charge, royalty-free, irrevocable (except as stated in this section) patent license to make, have made, use, offer to sell, sell, import, and otherwise transfer the Work, where such license applies only to those patent claims licensable by such Contributor that are necessarily infringed by their Contribution(s) alone or by combination of their Contribution(s) with the Work to which such Contribution(s) was submitted. If You institute patent litigation against any entity (including a cross-claim or counterclaim in a lawsuit) alleging that the Work or a Contribution incorporated within the Work constitutes direct or contributory patent infringement, then any patent licenses granted to You under this License for that Work shall terminate as of the date such litigation is filed.

4. Redistribution. You may reproduce and distribute copies of the Work or Derivative Works thereof in any medium, with or without modifications, and in Source or Object form, provided that You meet the following conditions:

   1. You must give any other recipients of the Work or Derivative Works a copy of this License; and

   2. You must cause any modified files to carry prominent notices stating that You changed the files; and

   3. You must retain, in the Source form of any Derivative Works that You distribute, all copyright, patent, trademark, and attribution notices from the Source form of the Work, excluding those notices that do not pertain to any part of the Derivative Works; and

   4. If the Work includes a "NOTICE" text file as part of its distribution, then any Derivative Works that You distribute must include a readable copy of the attribution notices contained within such NOTICE file, excluding those notices that do not pertain to any part of the Derivative Works, in at least one of the following places: within a NOTICE text file distributed as part of the Derivative Works; within the Source form or documentation, if provided along with the Derivative Works; or, within a display generated by the Derivative Works, if and wherever such third-party notices normally appear. The contents of the NOTICE file are for informational purposes only and do not modify the License. You may add Your own attribution notices within Derivative Works that You distribute, alongside or as an addendum to the NOTICE text from the Work, provided that such additional attribution notices cannot be construed as modifying the License.

You may add Your own copyright statement to Your modifications and may provide additional or different license terms and conditions for use, reproduction, or distribution of Your modifications, or for any such Derivative Works as a whole, provided Your use, reproduction, and distribution of the Work otherwise complies with the conditions stated in this License.

5. Submission of Contributions. Unless You explicitly state otherwise, any Contribution intentionally submitted for inclusion in the Work by You to the Licensor shall be under the terms and conditions of this License, without any additional terms or conditions. Notwithstanding the above, nothing herein shall supersede or modify the terms of any separate license agreement you may have executed with Licensor regarding such Contributions.

6. Trademarks. This License does not grant permission to use the trade names, trademarks, service marks, or product names of the Licensor, except as required for reasonable and customary use in describing the origin of the Work and reproducing the content of the NOTICE file.

7. Disclaimer of Warranty. Unless required by applicable law or agreed to in writing, Licensor provides the Work (and each Contributor provides its Contributions) on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied, including, without limitation, any warranties or conditions of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A PARTICULAR PURPOSE. You are solely responsible for determining the appropriateness of using or redistributing the Work and assume any risks associated with Your exercise of permissions under this License.

8. Limitation of Liability. In no event and under no legal theory, whether in tort (including negligence), contract, or otherwise, unless required by applicable law (such as deliberate and grossly negligent acts) or agreed to in writing, shall any Contributor be liable to You for damages, including any direct, indirect, special, incidental, or consequential damages of any character arising as a result of this License or out of the use or inability to use the Work (including but not limited to damages for loss of goodwill, work stoppage, computer failure or malfunction, or any and all other commercial damages or losses), even if such Contributor has been advised of the possibility of such damages.

9. Accepting Warranty or Additional Liability. While redistributing the Work or Derivative Works thereof, You may choose to offer, and charge a fee for, acceptance of support, warranty, indemnity, or other liability obligations and/or rights consistent with this License. However, in accepting such obligations, You may act only on Your own behalf and on Your sole responsibility, not on behalf of any other Contributor, and only if You agree to indemnify, defend, and hold each Contributor harmless for any liability incurred by, or claims asserted against, such Contributor by reason of your accepting any such warranty or additional liability.

END OF TERMS AND CONDITIONS

