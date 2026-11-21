import { describe, expect, it } from "vitest";
import { instrumentByName, MusicXmlError, musicXmlToAudioClip } from "./musicXmlImport";
import { parseXml } from "./xmlLite";
import { parseAudioClip, stepTime } from "./audioClip";

const SCORE = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <work><work-title>Tiny &amp; sad</work-title></work>
  <part-list>
    <score-part id="P1"><part-name>Violin</part-name></score-part>
    <score-part id="P2"><part-name>Keys</part-name><midi-instrument id="P2-I1"><midi-channel>1</midi-channel><midi-program>1</midi-program></midi-instrument></score-part>
    <score-part id="P3"><part-name>Clarinet in Bb</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <direction placement="above"><direction-type><dynamics><p/></dynamics></direction-type><sound tempo="90"/></direction>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type></note>
      <note><chord/><pitch><step>E</step><octave>5</octave></pitch><duration>2</duration></note>
      <note><rest/><duration>2</duration></note>
      <!-- a tie across the bar line -->
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>4</duration><tie type="start"/><notations><tied type="start"/></notations></note>
    </measure>
    <measure number="2">
      <direction><direction-type><words>slower</words></direction-type><sound tempo="60"/></direction>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>2</duration><tie type="stop"/></note>
      <note><grace/><pitch><step>F</step><octave>5</octave></pitch><type>eighth</type></note>
      <note><pitch><step>F</step><alter>1</alter><octave>5</octave></pitch><duration>2</duration></note>
      <note><rest/><duration>4</duration></note>
    </measure>
  </part>
  <part id="P2">
    <measure number="1">
      <attributes><divisions>2</divisions></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice></note>
      <backup><duration>8</duration></backup>
      <note><pitch><step>G</step><octave>3</octave></pitch><duration>4</duration><voice>2</voice></note>
      <forward><duration>2</duration></forward>
      <note><pitch><step>B</step><alter>-1</alter><octave>3</octave></pitch><duration>2</duration><voice>2</voice></note>
    </measure>
    <measure number="2">
      <note><rest measure="yes"/><duration>8</duration></note>
    </measure>
  </part>
  <part id="P3">
    <measure number="1">
      <attributes><divisions>1</divisions><transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose></attributes>
      <note dynamics="100"><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration></note>
    </measure>
    <measure number="2"><note><rest/><duration>4</duration></note></measure>
  </part>
</score-partwise>`;

describe("MusicXML import (P91)", () => {
  it("reads the small XML subset MusicXML needs", () => {
    const x = parseXml(`<?xml version="1.0"?><!DOCTYPE a [<!ENTITY x "y">]><a k='1 &lt; 2'><!-- c --><b>t&#233;&amp;<![CDATA[<raw>]]></b><c/></a>`);
    expect(x.name).toBe("a");
    expect(x.attrs.k).toBe("1 < 2");
    expect(x.children.map((c) => c.name)).toEqual(["b", "c"]);
    expect(x.children[0].text).toBe("té&<raw>");
    expect(() => parseXml("<a><b></a>")).toThrow();
  });

  it("turns parts into tracks with divisions, chords, rests, ties, backup/forward, tempo, dynamics and transposition", () => {
    const { clip, warnings } = musicXmlToAudioClip(SCORE);
    expect(warnings).toEqual([]);
    expect(clip.name).toBe("Tiny & sad");
    expect(clip.stepsPerBeat).toBe(2);
    expect(clip.tempo).toBe(90);
    expect(clip.tempoMap).toEqual([{ step: 8, tempo: 60 }]);
    expect(clip.steps).toBe(16);
    const [vln, keys, clar] = clip.tracks;
    expect(vln).toMatchObject({ id: "violin", instrument: "sampler", sampler: "violin" });
    expect(vln.notes).toEqual([
      { step: 0, len: 2, pitch: 72, vel: 0.42 },
      { step: 0, len: 2, pitch: 76, vel: 0.42 },
      { step: 4, len: 6, pitch: 74, vel: 0.42 }, // half tied to a quarter
      { step: 10, len: 2, pitch: 78, vel: 0.42 }, // the grace note takes no time
    ]);
    expect(keys).toMatchObject({ instrument: "sampler", sampler: "piano" }); // midi-program 1 = GM 0
    expect(keys.notes!.map((n) => [n.step, n.len ?? 1, n.pitch])).toEqual([[0, 4, 55], [0, 8, 60], [6, 2, 58]]);
    expect(clar).toMatchObject({ instrument: "sampler", sampler: "flute" });
    expect(clar.notes).toEqual([{ step: 0, len: 8, pitch: 60, vel: 0.71 }]); // written D4 in Bb sounds C4
    expect(stepTime(clip, 8)).toBeCloseTo((4 * 60) / 90, 9);
    const r = parseAudioClip(clip);
    expect(r.ok, JSON.stringify(r.issues)).toBe(true);
    if (r.ok) expect(r.issues).toEqual([]);
  });

  it("warns about repeats and rejects what it can't read", () => {
    const rep = SCORE.replace('<measure number="2">\n      <direction>', '<measure number="2">\n      <barline location="right"><repeat direction="backward"/></barline>\n      <direction>');
    expect(musicXmlToAudioClip(rep).warnings.join(" ")).toContain("Repeats");
    expect(() => musicXmlToAudioClip("<score-timewise/>")).toThrow(MusicXmlError);
    expect(() => musicXmlToAudioClip("<html></html>")).toThrow(/Not a MusicXML score/);
    expect(() => musicXmlToAudioClip("<score-partwise><part-list/></score-partwise>")).toThrow(/no parts/);
  });

  it("guesses instruments from part names", () => {
    expect(instrumentByName("Violoncello")).toEqual({ instrument: "sampler", sampler: "cello" });
    expect(instrumentByName("Violins I")).toEqual({ instrument: "sampler", sampler: "strings" });
    expect(instrumentByName("Horn in F")).toEqual({ instrument: "sampler", sampler: "horn" });
    expect(instrumentByName("Timpani")).toEqual({ instrument: "sampler", sampler: "timpani" });
    expect(instrumentByName("Drum Set")).toBe("drums");
    expect(instrumentByName("Theremin")).toBeUndefined();
  });
});
