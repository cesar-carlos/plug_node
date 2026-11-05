import { NodeHelpers } from "n8n-workflow";
import { expect, it } from "vitest";
import { buildActionIoProperties } from "../../packages/n8n-nodes-plug-database/generated/shared/n8n/actionIoDescription";

it.each(["run", "validateRun", "sendInput"])(
  "resolves saved input fields for %s",
  (operation) => {
    const fields = buildActionIoProperties();
    const inputNames = ["actionInputFormat", "actionBase64", "actionBinaryField"];
    for (const actionInitial of [false, true]) {
      for (const actionInputFormat of ["base64", "binary"]) {
        const saved = {
          operation,
          actionInitial,
          actionInputFormat,
          actionBase64: "YQ==",
          actionBinaryField: "arquivo",
        };
        const visible = fields
          .filter(
            (field) =>
              inputNames.includes(field.name) &&
              NodeHelpers.displayParameter(saved, field, null, null),
          )
          .map((field) => field.name);
        expect(visible).toEqual(
          actionInitial || operation === "sendInput"
            ? [
                "actionInputFormat",
                actionInputFormat === "base64" ? "actionBase64" : "actionBinaryField",
              ]
            : [],
        );
        const resolved = NodeHelpers.getNodeParameters(
          fields,
          saved,
          true,
          false,
          null,
          null,
        );
        for (const name of visible)
          expect(resolved?.[name]).toEqual(saved[name as keyof typeof saved]);
      }
    }
  },
);
