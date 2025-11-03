import DataTable from "../../src/components/table/DataTable.tsx";

export default function ExampleDataTable() {
  return (
    <DataTable
      items={[
        {
          name: "Hydrogen",
          symbol: "H",
          atomicMass: 1.008,
        },
      ]}
      columns={{
        name: { label: "Element Name", value: (item) => item.name },
        symbol: { label: "Symbol", value: (item) => item.symbol },
        atomicMass: { label: "Atomic Mass", value: (item) => item.atomicMass },
      }}
    />
  );
}
