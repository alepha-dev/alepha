import * as React from "react";

void React;

import { ControlUpload } from "@alepha/ui/components/control-upload/control-upload";
import { Button } from "@alepha/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@alepha/ui/components/ui/card";
import type { FormModel } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { ArrowLeft, ArrowRight, Star } from "lucide-react";

import type { imagesFormSchema } from "./images-form-schema.ts";
import { productImageUrl } from "./product-image-url.ts";

export interface AdminProductDetailMediaTabProps {
  form: FormModel<typeof imagesFormSchema>;
  images: string[];
  onReorder: (next: string[]) => void;
  saving: boolean;
  onSave: () => void;
}

/**
 * The product's photographs.
 *
 * `products.images` is ordered and the first entry is what a listing shows, so
 * order is content, not presentation — which is why this offers explicit
 * move-left/move-right controls rather than leaving the sequence to whatever
 * order the files were uploaded in. Drag-and-drop would be nicer and needs a
 * dependency this package does not otherwise carry.
 *
 * The upload control stores file ids; an entry may also be an absolute URL for
 * a catalogue served from a CDN, which is why previews go through
 * {@link productImageUrl} rather than straight to the files route.
 */
export const AdminProductDetailMediaTab = (
  props: AdminProductDetailMediaTabProps,
) => {
  const { tr } = useI18n();

  const move = (from: number, to: number) => {
    if (to < 0 || to >= props.images.length) return;
    const next = [...props.images];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    props.onReorder(next);
  };

  return (
    <div className="min-h-0 flex-1 overflow-auto p-6">
      <Card>
        <CardHeader>
          <CardTitle>
            {tr("commerce.admin.media.title", { default: "Images" })}
          </CardTitle>
          <CardDescription>
            {tr("commerce.admin.media.hint", {
              default:
                "The first image is the one the shop shows in listings. Use the arrows to change the order.",
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <ControlUpload
            input={props.form.input.images}
            multi
            accept="image/*"
            label={String(
              tr("commerce.admin.media.upload", { default: "Add images" }),
            )}
            image={{ maxWidth: 2048 }}
          />

          {props.images.length > 0 ? (
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {props.images.map((ref, index) => (
                <li
                  key={ref}
                  className="border-border flex flex-col gap-2 rounded-md border p-2"
                >
                  <div className="bg-muted relative aspect-square overflow-hidden rounded">
                    <img
                      src={productImageUrl(ref)}
                      alt=""
                      loading="lazy"
                      className="size-full object-cover"
                    />
                    {index === 0 ? (
                      <span className="bg-background/90 text-foreground absolute top-1 left-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium">
                        <Star className="size-3" />
                        {tr("commerce.admin.media.listing", {
                          default: "Listing",
                        })}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center justify-between gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      disabled={index === 0}
                      onClick={() => move(index, index - 1)}
                      aria-label={String(
                        tr("commerce.admin.media.moveEarlier", {
                          default: "Move earlier",
                        }),
                      )}
                    >
                      <ArrowLeft className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      disabled={index === props.images.length - 1}
                      onClick={() => move(index, index + 1)}
                      aria-label={String(
                        tr("commerce.admin.media.moveLater", {
                          default: "Move later",
                        }),
                      )}
                    >
                      <ArrowRight className="size-3.5" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">
              {tr("commerce.admin.media.empty", {
                default: "This product has no image yet.",
              })}
            </p>
          )}

          <div>
            <Button size="sm" loading={props.saving} onClick={props.onSave}>
              {tr("commerce.admin.save", { default: "Save" })}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
