import { createPagination, t } from "@alepha/core";
import DataTable from "../../src/components/table/DataTable.tsx";

const elements = [
  { name: "Hydrogen", symbol: "H", atomicMass: 1.008 },
  { name: "Helium", symbol: "He", atomicMass: 4.0026 },
  { name: "Lithium", symbol: "Li", atomicMass: 6.94 },
  { name: "Beryllium", symbol: "Be", atomicMass: 9.0122 },
  { name: "Boron", symbol: "B", atomicMass: 10.81 },
  { name: "Carbon", symbol: "C", atomicMass: 12.011 },
  { name: "Nitrogen", symbol: "N", atomicMass: 14.007 },
  { name: "Oxygen", symbol: "O", atomicMass: 15.999 },
  { name: "Fluorine", symbol: "F", atomicMass: 18.998 },
  { name: "Neon", symbol: "Ne", atomicMass: 20.18 },
  { name: "Sodium", symbol: "Na", atomicMass: 22.99 },
  { name: "Magnesium", symbol: "Mg", atomicMass: 24.305 },
  { name: "Aluminum", symbol: "Al", atomicMass: 26.982 },
  { name: "Silicon", symbol: "Si", atomicMass: 28.085 },
  { name: "Phosphorus", symbol: "P", atomicMass: 30.974 },
  { name: "Sulfur", symbol: "S", atomicMass: 32.06 },
  { name: "Chlorine", symbol: "Cl", atomicMass: 35.45 },
  { name: "Argon", symbol: "Ar", atomicMass: 39.948 },
  { name: "Potassium", symbol: "K", atomicMass: 39.098 },
  { name: "Calcium", symbol: "Ca", atomicMass: 40.078 },
  { name: "Scandium", symbol: "Sc", atomicMass: 44.956 },
  { name: "Titanium", symbol: "Ti", atomicMass: 47.867 },
  { name: "Vanadium", symbol: "V", atomicMass: 50.941 },
  { name: "Chromium", symbol: "Cr", atomicMass: 51.996 },
  { name: "Manganese", symbol: "Mn", atomicMass: 54.938 },
  { name: "Iron", symbol: "Fe", atomicMass: 55.845 },
  { name: "Cobalt", symbol: "Co", atomicMass: 58.933 },
  { name: "Nickel", symbol: "Ni", atomicMass: 58.693 },
  { name: "Copper", symbol: "Cu", atomicMass: 63.546 },
  { name: "Zinc", symbol: "Zn", atomicMass: 65.38 },
  { name: "Gallium", symbol: "Ga", atomicMass: 69.723 },
  { name: "Germanium", symbol: "Ge", atomicMass: 72.63 },
  { name: "Arsenic", symbol: "As", atomicMass: 74.922 },
  { name: "Selenium", symbol: "Se", atomicMass: 78.971 },
  { name: "Bromine", symbol: "Br", atomicMass: 79.904 },
  { name: "Krypton", symbol: "Kr", atomicMass: 83.798 },
  { name: "Rubidium", symbol: "Rb", atomicMass: 85.468 },
  { name: "Strontium", symbol: "Sr", atomicMass: 87.62 },
  { name: "Yttrium", symbol: "Y", atomicMass: 88.906 },
  { name: "Zirconium", symbol: "Zr", atomicMass: 91.224 },
  { name: "Niobium", symbol: "Nb", atomicMass: 92.906 },
  { name: "Molybdenum", symbol: "Mo", atomicMass: 95.95 },
  { name: "Technetium", symbol: "Tc", atomicMass: 98 },
  { name: "Ruthenium", symbol: "Ru", atomicMass: 101.07 },
  { name: "Rhodium", symbol: "Rh", atomicMass: 102.91 },
  { name: "Palladium", symbol: "Pd", atomicMass: 106.42 },
  { name: "Silver", symbol: "Ag", atomicMass: 107.87 },
  { name: "Cadmium", symbol: "Cd", atomicMass: 112.41 },
  { name: "Indium", symbol: "In", atomicMass: 114.82 },
  { name: "Tin", symbol: "Sn", atomicMass: 118.71 },
  { name: "Antimony", symbol: "Sb", atomicMass: 121.76 },
  { name: "Tellurium", symbol: "Te", atomicMass: 127.6 },
  { name: "Iodine", symbol: "I", atomicMass: 126.9 },
  { name: "Xenon", symbol: "Xe", atomicMass: 131.29 },
  { name: "Cesium", symbol: "Cs", atomicMass: 132.91 },
  { name: "Barium", symbol: "Ba", atomicMass: 137.33 },
  { name: "Lanthanum", symbol: "La", atomicMass: 138.91 },
  { name: "Cerium", symbol: "Ce", atomicMass: 140.12 },
  { name: "Praseodymium", symbol: "Pr", atomicMass: 140.91 },
  { name: "Neodymium", symbol: "Nd", atomicMass: 144.24 },
  { name: "Promethium", symbol: "Pm", atomicMass: 145 },
  { name: "Samarium", symbol: "Sm", atomicMass: 150.36 },
  { name: "Europium", symbol: "Eu", atomicMass: 151.96 },
  { name: "Gadolinium", symbol: "Gd", atomicMass: 157.25 },
  { name: "Terbium", symbol: "Tb", atomicMass: 158.93 },
  { name: "Dysprosium", symbol: "Dy", atomicMass: 162.5 },
  { name: "Holmium", symbol: "Ho", atomicMass: 164.93 },
  { name: "Erbium", symbol: "Er", atomicMass: 167.26 },
  { name: "Thulium", symbol: "Tm", atomicMass: 168.93 },
  { name: "Ytterbium", symbol: "Yb", atomicMass: 173.05 },
  { name: "Lutetium", symbol: "Lu", atomicMass: 174.97 },
  { name: "Hafnium", symbol: "Hf", atomicMass: 178.49 },
  { name: "Tantalum", symbol: "Ta", atomicMass: 180.95 },
  { name: "Tungsten", symbol: "W", atomicMass: 183.84 },
  { name: "Rhenium", symbol: "Re", atomicMass: 186.21 },
  { name: "Osmium", symbol: "Os", atomicMass: 190.23 },
  { name: "Iridium", symbol: "Ir", atomicMass: 192.22 },
  { name: "Platinum", symbol: "Pt", atomicMass: 195.08 },
  { name: "Gold", symbol: "Au", atomicMass: 196.97 },
  { name: "Mercury", symbol: "Hg", atomicMass: 200.59 },
  { name: "Thallium", symbol: "Tl", atomicMass: 204.38 },
  { name: "Lead", symbol: "Pb", atomicMass: 207.2 },
  { name: "Bismuth", symbol: "Bi", atomicMass: 208.98 },
  { name: "Polonium", symbol: "Po", atomicMass: 209 },
  { name: "Astatine", symbol: "At", atomicMass: 210 },
  { name: "Radon", symbol: "Rn", atomicMass: 222 },
  { name: "Francium", symbol: "Fr", atomicMass: 223 },
  { name: "Radium", symbol: "Ra", atomicMass: 226 },
  { name: "Actinium", symbol: "Ac", atomicMass: 227 },
  { name: "Thorium", symbol: "Th", atomicMass: 232.04 },
  { name: "Protactinium", symbol: "Pa", atomicMass: 231.04 },
  { name: "Uranium", symbol: "U", atomicMass: 238.03 },
  { name: "Neptunium", symbol: "Np", atomicMass: 237 },
  { name: "Plutonium", symbol: "Pu", atomicMass: 244 },
  { name: "Americium", symbol: "Am", atomicMass: 243 },
  { name: "Curium", symbol: "Cm", atomicMass: 247 },
  { name: "Berkelium", symbol: "Bk", atomicMass: 247 },
  { name: "Californium", symbol: "Cf", atomicMass: 251 },
  { name: "Einsteinium", symbol: "Es", atomicMass: 252 },
  { name: "Fermium", symbol: "Fm", atomicMass: 257 },
  { name: "Mendelevium", symbol: "Md", atomicMass: 258 },
  { name: "Nobelium", symbol: "No", atomicMass: 259 },
  { name: "Lawrencium", symbol: "Lr", atomicMass: 266 },
  { name: "Rutherfordium", symbol: "Rf", atomicMass: 267 },
  { name: "Dubnium", symbol: "Db", atomicMass: 268 },
  { name: "Seaborgium", symbol: "Sg", atomicMass: 269 },
  { name: "Bohrium", symbol: "Bh", atomicMass: 270 },
  { name: "Hassium", symbol: "Hs", atomicMass: 277 },
  { name: "Meitnerium", symbol: "Mt", atomicMass: 278 },
  { name: "Darmstadtium", symbol: "Ds", atomicMass: 281 },
  { name: "Roentgenium", symbol: "Rg", atomicMass: 282 },
  { name: "Copernicium", symbol: "Cn", atomicMass: 285 },
  { name: "Nihonium", symbol: "Nh", atomicMass: 286 },
  { name: "Flerovium", symbol: "Fl", atomicMass: 289 },
  { name: "Moscovium", symbol: "Mc", atomicMass: 290 },
  { name: "Livermorium", symbol: "Lv", atomicMass: 293 },
  { name: "Tennessine", symbol: "Ts", atomicMass: 294 },
  { name: "Oganesson", symbol: "Og", atomicMass: 294 },
];

const getElements = (filters: Record<string, any>) => {
  let result = [...elements];

  if (filters.search) {
    result = result.filter(
      (element) =>
        element.name.toLowerCase().includes(filters.search.toLowerCase()) ||
        element.symbol.toLowerCase().includes(filters.search.toLowerCase()),
    );
  }

  const size = filters.size ?? 10;
  const page = filters.page ?? 0;
  const offset = page * size;

  const items = createPagination(
    result.slice(offset, offset + size),
    size,
    offset,
  );

  items.page.totalElements = result.length;
  items.page.totalPages = Math.ceil(result.length / items.page.size);

  return items;
};

export default function ExampleDataTable() {
  return (
    <DataTable
      submitOnInit
      filters={t.object({
        search: t.optional(t.string({ label: "Search" })),
      })}
      items={(filters) => getElements(filters)}
      columns={{
        index: {
          label: "#",
          value: (_, index) => index + 1,
        },
        name: { label: "Element Name", value: (item) => item.name },
        symbol: { label: "Symbol", value: (item) => item.symbol },
        atomicMass: { label: "Atomic Mass", value: (item) => item.atomicMass },
      }}
    />
  );
}
