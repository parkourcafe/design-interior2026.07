import type { Passport, MoneyRange } from "@/lib/types";
import { ru } from "@/lib/i18n/ru";

const pv = ru.passportView;

const OBJECT_TYPE_LABEL: Record<string, string> = {
  flat: "квартира",
  house: "дом",
  apartments: "апартаменты",
};

const BUILDING_LABEL: Record<string, string> = {
  new: "новостройка",
  secondary: "вторичка",
  private: "частный дом",
};

const CONDITION_LABEL: Record<string, string> = {
  shell: "пустая коробка",
  rough: "черновая",
  lived: "жилое (демонтаж)",
};

const REPLANNING_LABEL: Record<string, string> = {
  no: "без перепланировки",
  maybe: "думают о перепланировке",
  yes: "перепланировка нужна",
};

const DECISION_LABEL: Record<string, string> = {
  single: "решает один",
  couple: "решают вдвоём",
  family: "решает вся семья",
};

const FURNITURE_LABEL: Record<string, string> = {
  all_new: "вся мебель новая",
  partial: "часть мебели оставляют",
  own: "переезжают со своей мебелью",
};

const INCLUDES_FURNITURE_LABEL: Record<string, string> = {
  yes: "включает мебель",
  no: "без мебели",
  unsure: "не знает, включает ли мебель",
};

const REQUIREMENT_LABEL: Record<string, string> = {
  warm_floor: "тёплый пол",
  ac: "кондиционирование",
  smart: "умный дом",
  allergy: "аллергии",
  accessibility: "маломобильность",
  soundproof: "шумоизоляция",
};

const DIRECTION_LABEL: Record<string, string> = {
  modern: "современный",
  scandi: "скандинавский",
  minimal: "минимализм",
  neoclassic: "неоклассика",
  classic: "классика",
  loft: "лофт",
  japandi: "джапанди/эко",
  provence: "прованс/кантри",
};

const PALETTE_LABEL: Record<string, string> = {
  light: "светлая",
  dark: "тёмная",
  warm: "тёплая нейтральная",
  cool: "холодная",
  contrast: "контрастная",
};

const KITCHEN_LAYOUT_LABEL: Record<string, string> = {
  linear: "линейная",
  corner: "угловая",
  u: "П-образная",
  island: "с островом",
  peninsula: "с полуостровом",
};
const KITCHEN_BAR_LABEL: Record<string, string> = { yes: "барная стойка", no: "без бара" };
const KITCHEN_DINING_LABEL: Record<string, string> = {
  "2": "обед. зона на 2",
  "4": "обед. зона на 4",
  "6plus": "обед. зона на 6+",
  separate: "отдельная столовая",
  none: "без обед. зоны",
};
const BATH_COUNT_LABEL: Record<string, string> = {
  one: "1 санузел",
  two: "2 санузла",
  separate: "раздельный",
};
const BATH_SINKS_LABEL: Record<string, string> = { one: "1 раковина", two: "2 раковины" };
const BATH_SHOWER_LABEL: Record<string, string> = {
  bath: "ванна",
  shower: "душ",
  both: "ванна и душ",
  two_showers: "2 душевые",
};

const BEDROOMS_LABEL: Record<string, string> = {
  "1": "1 спальня",
  "2": "2 спальни",
  "3": "3 спальни",
  "4plus": "4+ спальни",
};
const LIVING_LABEL: Record<string, string> = {
  open: "кухня-гостиная",
  kitchen_living_dining: "кухня-столовая-гостиная",
  separate: "отдельная гостиная",
  none: "без гостиной",
};
const HALLWAY_LABEL: Record<string, string> = {
  wardrobe: "шкаф/гардероб",
  seat: "место присесть",
  stroller: "коляска/велосипед",
  mirror: "зеркало",
};
const BALCONY_LABEL: Record<string, string> = {
  attach: "присоединить балкон",
  lounge: "балкон — зона отдыха",
  storage: "балкон — хранение",
  asis: "балкон как есть",
  none: "без балкона",
};
const VIEW_LABEL: Record<string, string> = {
  yard: "вид во двор",
  city: "вид на город",
  nature: "вид на природу",
  bad: "вид так себе",
};
const DOORS_LABEL: Record<string, string> = {
  standard: "распашные двери",
  hidden: "скрытые двери",
  sliding: "раздвижные двери",
  mixed: "двери по-разному",
};
const NEIGHBORS_LABEL: Record<string, string> = {
  quiet: "дом заселён, тихо",
  partial: "частично ремонтируют",
  active: "вокруг активная стройка",
};

const ZONE_LABEL: Record<string, string> = {
  kids: "детская",
  office: "кабинет",
  walkin: "гардеробная",
  master_ensuite: "мастер-спальня с санузлом",
  guest: "гостевая",
  dining: "столовая",
  laundry: "постирочная/кладовая",
  gym: "спортзона",
  library: "библиотека",
  hobby: "мастерская/хобби",
};

function joinLabels(values: (string | undefined)[]): string {
  return values.filter((v): v is string => Boolean(v)).join(", ");
}

function money(range: MoneyRange | "undisclosed"): string {
  if (range === "undisclosed") return pv.undisclosed;
  return `${range[0].toLocaleString("ru-RU")}–${range[1].toLocaleString("ru-RU")} ₽`;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-line py-2 last:border-0 sm:flex-row sm:gap-4">
      <div className="w-40 shrink-0 text-sm text-muted">{label}</div>
      <div className="text-sm">{children}</div>
    </div>
  );
}

export default function PassportView({ passport }: { passport: Passport }) {
  const o = passport.object;
  return (
    <div className="card">
      <Row label={pv.object}>
        {o.type ? OBJECT_TYPE_LABEL[o.type] ?? o.type : pv.notFilled}
        {o.area_m2 ? `, ${o.area_m2} м²` : ""}
        {o.city ? `, ${o.city}` : ""}
        {o.district ? `, р-н ${o.district}` : ""}
        {typeof o.floor === "number" ? `, ${o.floor} этаж` : ""}
        {o.building ? `, ${BUILDING_LABEL[o.building]}` : ""}
        {o.condition ? ` · ${CONDITION_LABEL[o.condition]}` : ""}
        {o.replanning ? ` · ${REPLANNING_LABEL[o.replanning]}` : ""}
        {o.neighbors_renovation ? ` · ${NEIGHBORS_LABEL[o.neighbors_renovation]}` : ""}
      </Row>
      {passport.vision && (
        <Row label="Видение клиента">
          <span className="italic">«{passport.vision}»</span>
        </Row>
      )}
      <Row label={pv.assetHorizon}>{pv.assetHorizonValue[passport.asset_horizon]}</Row>
      <Row label={pv.household}>
        {pv.now}: {passport.household.now}; {pv.in5y}: {passport.household.in_5y}
        {passport.household.kids ? ` · ${pv.kids}` : ""}
        {passport.household.pets ? ` · ${pv.pets}` : ""}
        {passport.household.decision_makers
          ? ` · ${DECISION_LABEL[passport.household.decision_makers]}`
          : ""}
      </Row>
      <Row label={pv.lifestyle}>
        {pv.morningLoad}: {pv.loadValue[passport.lifestyle.morning_load]}
        {passport.lifestyle.bathrooms ? ` · ${pv.bathrooms}: ${passport.lifestyle.bathrooms}` : ""}
        {" · "}
        {pv.cooking}: {pv.cookingValue[passport.lifestyle.cooking]}
        {" · "}
        {pv.storage}: {pv.loadValue[passport.lifestyle.storage_pressure]}
        {passport.lifestyle.furniture_keep
          ? ` · ${FURNITURE_LABEL[passport.lifestyle.furniture_keep]}`
          : ""}
        {passport.lifestyle.requirements && passport.lifestyle.requirements.length > 0
          ? ` · ${passport.lifestyle.requirements
              .map((r) => REQUIREMENT_LABEL[r] ?? r)
              .join(", ")}`
          : ""}
      </Row>
      <Row label={pv.budget}>
        {money(passport.budget.range)}
        {passport.budget.includes_furniture
          ? ` · ${INCLUDES_FURNITURE_LABEL[passport.budget.includes_furniture]}`
          : ""}
      </Row>
      <Row label={pv.timeline}>
        {passport.timeline.target} · {pv.urgencyValue[passport.timeline.urgency]}
        {passport.timeline.hard_deadline ? ` · дедлайн: ${passport.timeline.hard_deadline}` : ""}
      </Row>
      {passport.rooms && (
        <Row label="Помещения">
          {passport.rooms.kitchen && (
            <div>
              Кухня:{" "}
              {joinLabels([
                passport.rooms.kitchen.layout
                  ? KITCHEN_LAYOUT_LABEL[passport.rooms.kitchen.layout]
                  : undefined,
                passport.rooms.kitchen.bar ? KITCHEN_BAR_LABEL[passport.rooms.kitchen.bar] : undefined,
                passport.rooms.kitchen.dining
                  ? KITCHEN_DINING_LABEL[passport.rooms.kitchen.dining]
                  : undefined,
              ]) || pv.notFilled}
            </div>
          )}
          {passport.rooms.bath && (
            <div>
              Санузел:{" "}
              {joinLabels([
                passport.rooms.bath.count ? BATH_COUNT_LABEL[passport.rooms.bath.count] : undefined,
                passport.rooms.bath.sinks ? BATH_SINKS_LABEL[passport.rooms.bath.sinks] : undefined,
                passport.rooms.bath.shower ? BATH_SHOWER_LABEL[passport.rooms.bath.shower] : undefined,
              ]) || pv.notFilled}
            </div>
          )}
          {(passport.rooms.bedrooms || passport.rooms.living) && (
            <div>
              Планировка:{" "}
              {joinLabels([
                passport.rooms.bedrooms ? BEDROOMS_LABEL[passport.rooms.bedrooms] : undefined,
                passport.rooms.living ? LIVING_LABEL[passport.rooms.living] : undefined,
              ])}
            </div>
          )}
          {passport.rooms.zones && passport.rooms.zones.length > 0 && (
            <div>Зоны: {passport.rooms.zones.map((z) => ZONE_LABEL[z] ?? z).join(", ")}</div>
          )}
          {passport.rooms.hallway && passport.rooms.hallway.length > 0 && (
            <div>Прихожая: {passport.rooms.hallway.map((h) => HALLWAY_LABEL[h] ?? h).join(", ")}</div>
          )}
          {(passport.rooms.balcony || passport.rooms.view || passport.rooms.doors) && (
            <div>
              {joinLabels([
                passport.rooms.balcony ? BALCONY_LABEL[passport.rooms.balcony] : undefined,
                passport.rooms.view ? VIEW_LABEL[passport.rooms.view] : undefined,
                passport.rooms.doors ? DOORS_LABEL[passport.rooms.doors] : undefined,
              ])}
            </div>
          )}
        </Row>
      )}
      <Row label={pv.style}>
        {(passport.style.directions?.length || passport.style.palette) && (
          <div>
            {passport.style.directions?.length
              ? passport.style.directions.map((d) => DIRECTION_LABEL[d] ?? d).join(", ")
              : ""}
            {passport.style.palette
              ? `${passport.style.directions?.length ? " · " : ""}палитра: ${PALETTE_LABEL[passport.style.palette] ?? passport.style.palette}`
              : ""}
          </div>
        )}
        {passport.style.refs.length > 0 && (
          <div>
            {pv.refs}:{" "}
            {passport.style.refs.map((r, i) => (
              <span key={i} className="break-all text-accent">
                {r}
                {i < passport.style.refs.length - 1 ? ", " : ""}
              </span>
            ))}
          </div>
        )}
        {passport.style.anti.length > 0 && (
          <div>
            {pv.anti}: {passport.style.anti.join(", ")}
          </div>
        )}
        {passport.style.notes && <div>{passport.style.notes}</div>}
        {passport.style.refs.length === 0 &&
          passport.style.anti.length === 0 &&
          !passport.style.notes &&
          !passport.style.directions?.length &&
          !passport.style.palette &&
          pv.notFilled}
      </Row>
      <Row label={pv.pain}>{passport.pain_points || pv.notFilled}</Row>
    </div>
  );
}
