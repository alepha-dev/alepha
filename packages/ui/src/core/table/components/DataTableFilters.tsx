import { Flex } from "@alepha/ui";
import { type TObject, t } from "alepha";
import type { FormModel } from "alepha/react/form";
import { useMemo } from "react";
import {
  default as TypeForm,
  type TypeFormProps,
} from "../../form/components/TypeForm.tsx";
import type { FilterVisibility } from "../interfaces/types.ts";

export interface DataTableFiltersProps {
  schema: TObject;
  form: FormModel<TObject>;
  typeFormProps?: Partial<Omit<TypeFormProps<TObject>, "form">>;
  filterVisibility: FilterVisibility;
}

const DataTableFilters = ({
  schema,
  form,
  typeFormProps,
  filterVisibility,
}: DataTableFiltersProps) => {
  const visibleSchema = useMemo(() => {
    const visibleKeys = Object.keys(schema.properties).filter(
      (key) => filterVisibility[key] !== false,
    );

    if (visibleKeys.length === 0) {
      return null;
    }

    const visibleProps = visibleKeys.reduce(
      (acc, key) => {
        acc[key] = schema.properties[key];
        return acc;
      },
      {} as Record<string, unknown>,
    );

    return t.object(visibleProps as TObject["properties"]);
  }, [schema, filterVisibility]);

  if (!visibleSchema) {
    return null;
  }

  return (
    <Flex surface flex={1} mt={-4} p="xs" m="xs" bdrs="md">
      <TypeForm
        {...typeFormProps}
        skipSubmitButton
        fill
        form={form}
        schema={visibleSchema}
        columns={{
          base: 1,
          sm: 2,
          md: 3,
          lg: 4,
          xl: 5,
        }}
      />
    </Flex>
  );
};

export default DataTableFilters;
