import type { ProjectLinkCategory } from "../core/url-policy";

export interface StudioProjectLinkCatalogItem {
  readonly id: string;
  readonly labelKey: string;
  readonly url: string;
  readonly category: ProjectLinkCategory;
}

export const studioProjectLinkCatalog: readonly StudioProjectLinkCatalogItem[] = [
  {
    id: "3ddd",
    labelKey: "projectLinks.catalog.3ddd",
    url: "https://3ddd.ru/",
    category: "reference",
  },
  {
    id: "archdaily",
    labelKey: "projectLinks.catalog.archdaily",
    url: "https://www.archdaily.com/",
    category: "reference",
  },
  {
    id: "pinterest",
    labelKey: "projectLinks.catalog.pinterest",
    url: "https://www.pinterest.com/",
    category: "reference",
  },
  {
    id: "dezeen",
    labelKey: "projectLinks.catalog.dezeen",
    url: "https://www.dezeen.com/",
    category: "reference",
  },
];
