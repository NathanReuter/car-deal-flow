import { describe, expect, it } from "vitest";
import { selectFipeModel } from "@/lib/integrations/fipe-model-match";

const T_CROSS_MODELS = [
  { code: "8642", name: "T-Cross 1.0 TSI Flex 12V 5p Mec." },
  { code: "10373", name: "T-Cross 200 TSI 1.0  Flex 12V 5p Aut." },
  { code: "10374", name: "T-Cross Comfor. 200 TSI 1.0 Flex 5p Aut." },
  { code: "11432", name: "T-Cross Ext. 250 TSI 1.4 Flex 16V 5p Aut" },
  { code: "10375", name: "T-Cross Hig. 250 TSI 1.4 Flex 16V 5p Aut" },
  { code: "10376", name: "T-Cross Sense 200 TSI 1.0 Flex 5p Aut." },
];

const ONIX_MODELS = [
  { code: "cruze", name: "CRUZE HB Black Bow Tie 1.4 TB Flex Aut." },
  { code: "hatch10", name: "ONIX HATCH 1.0 12V TB Flex 5p Aut." },
  { code: "hatchlt", name: "ONIX HATCH LT 1.0 12V TB Flex 5p Aut." },
  { code: "hatchltz", name: "ONIX HATCH LTZ 1.0 12V TB Flex 5p Aut." },
  { code: "hatchjoy", name: "ONIX HATCH Joy 1.0 8V Flex 5p Mec." },
  { code: "plusltz", name: "ONIX SEDAN Plus LTZ 1.0 12V TB Flex Aut." },
  { code: "pluslt", name: "ONIX SEDAN Plus LT 1.0 12V TB Flex Aut." },
  { code: "plusprem", name: "ONIX SED. Plus PREM. 1.0 12V TB Flex Aut" },
];

const RENEGADE_MODELS = [
  { code: "alt", name: "Renegade Altitude T270 1.3 TB Flex Aut." },
  { code: "ltd", name: "Renegade Limited T270 1.3 TB Flex Aut." },
  { code: "long", name: "Renegade Longitude T270 1.3 TB Flex Aut." },
];

const PALIO_MODELS = [
  { code: "cel", name: "Palio 1.0 Cel. ECON./ITALIA F.Flex 8V 4p" },
  { code: "attr", name: "Palio ATTRACTIVE 1.0 EVO Fire Flex 8V 4p" },
];

describe("selectFipeModel", () => {
  it("maps auction HL/AE abbreviations to FIPE Hig./Aut Highline", () => {
    const match = selectFipeModel(T_CROSS_MODELS, "T-Cross", "T Cross HL TSI AE", {
      transmission: "automatic",
    });
    expect(match.code).toBe("10375");
    expect(match.name).toContain("Hig.");
  });

  it("still matches full Highline wording against FIPE Hig. abbreviation", () => {
    const match = selectFipeModel(T_CROSS_MODELS, "T-Cross", "Highline 1.4 250 TSI", {
      transmission: "automatic",
    });
    expect(match.code).toBe("10375");
  });

  it("matches Sense trim without aliases", () => {
    const match = selectFipeModel(T_CROSS_MODELS, "T-Cross", "T Cross Sense Tsi", {
      transmission: "automatic",
    });
    expect(match.code).toBe("10376");
  });

  it("refuses when a real letter trim token is absent from the catalog family", () => {
    expect(() =>
      selectFipeModel(T_CROSS_MODELS, "T-Cross", "R-Line TSI", {
        transmission: "automatic",
      }),
    ).toThrow(/missing distinctive trim token/);
  });

  it("splits auction 10TMT / LTZ codes onto Onix Plus LTZ", () => {
    const match = selectFipeModel(ONIX_MODELS, "Onix", "PLUS 10TMT LTZ", {
      transmission: "automatic",
    });
    expect(match.code).toBe("plusltz");
  });

  it("does not let CRUZE win on shared HB body token alone", () => {
    const match = selectFipeModel(ONIX_MODELS, "Onix", "10MT HB", {
      transmission: "automatic",
    });
    expect(match.name).toMatch(/ONIX/i);
    expect(match.name).not.toMatch(/CRUZE/i);
  });

  it("maps Joye auction spelling to Joy", () => {
    const match = selectFipeModel(ONIX_MODELS, "Onix", "10MT JOYE", {
      transmission: "manual",
    });
    expect(match.code).toBe("hatchjoy");
  });

  it("prefix-matches truncated Attractive trim", () => {
    const match = selectFipeModel(PALIO_MODELS, "Palio Attract 1.0", "", {
      transmission: "manual",
    });
    expect(match.code).toBe("attr");
  });

  it("maps Lgtd auction abbreviation to Limited", () => {
    const match = selectFipeModel(RENEGADE_MODELS, "Renegade", "Lgtd T270", {
      transmission: "automatic",
    });
    expect(match.code).toBe("ltd");
  });

  it("ignores short catalog-absent noise like Ma on Saveiro Cross", () => {
    const models = [
      { code: "cross", name: "Saveiro CROSS 1.6 T.Flex 16V CD" },
      { code: "base", name: "Saveiro 1.6 Mi Total Flex 8V" },
    ];
    const match = selectFipeModel(models, "Saveiro Cd Cross Ma", "", {
      transmission: "manual",
    });
    expect(match.code).toBe("cross");
  });

  it("does not treat 1.0L liter suffix as Gol L trim", () => {
    const models = [
      { code: "oldL", name: "Gol L 1.3/ L/ LS/ C/ S/ BX/ Plus 1.6" },
      { code: "flex10", name: "Gol 1.0 Flex 12V 5p" },
      { code: "msi", name: "Gol 1.6 MSI Flex 16V 5p Aut." },
      { code: "golf", name: "Golf Comfort. 200 TSI 1.0 Flex 12V Aut." },
    ];
    const match = selectFipeModel(models, "Gol 1.0L Mc4", "", {
      transmission: "manual",
    });
    expect(match.code).toBe("flex10");
  });

  it("does not let Golf win a Gol query via prefix", () => {
    const models = [
      { code: "flex10", name: "Gol 1.0 Flex 12V 5p" },
      { code: "golf", name: "Golf Comfort. 200 TSI 1.0 Flex 12V Aut." },
    ];
    const match = selectFipeModel(models, "Gol 1.0L Mc4", "", {
      transmission: "automatic",
    });
    expect(match.code).toBe("flex10");
  });

  it("skips Lr prefix and matches Evoque family", () => {
    const models = [
      { code: "pure", name: "Range R.EVOQUE Pure  2.0 Aut. 5p" },
      { code: "dyn", name: "Range R.EVOQUE Dynamic 2.0 Aut 3p" },
      { code: "vogue", name: "Range Rover Vogue 3.0 TDV6 Diesel Aut." },
    ];
    const match = selectFipeModel(models, "Lr Evoque Pure P5D", "", {
      transmission: "automatic",
    });
    expect(match.code).toBe("pure");
  });

  it("ignores FL when it only exists on a different model family", () => {
    const models = [
      { code: "qq", name: "QQ 1.0 ACT FL 12V/1.0 12V Flex 5p" },
      { code: "tiggo20", name: "Tiggo 2.0 16V Aut. 5p" },
      { code: "tiggo15", name: "Tiggo 2 ACT 1.5 16V Flex Aut.5p" },
    ];
    const match = selectFipeModel(models, "Tiggo Fl 2.0 Mt", "", {
      transmission: "automatic",
    });
    expect(match.code).toBe("tiggo20");
  });
});
