import { ActionButton, Flex } from "@alepha/ui";
import { Text } from "@mantine/core";
import { IconArrowRight } from "@tabler/icons-react";
import type { CategoryResource } from "../../api/schemas/categorySchemas.ts";

export interface BlogCategoriesProps {
  categories: CategoryResource[];
}

const BlogCategories = ({ categories }: BlogCategoriesProps) => {
  return (
    <Flex direction="column" maw={720} mx="auto" w="100%">
      {/* Header */}
      <Flex
        direction="column"
        mb="xl"
        pb="lg"
        style={{ borderBottom: "1px solid var(--blog-border)" }}
      >
        <Text
          fw={700}
          fz={{ base: "1.5rem", sm: "2rem" }}
          c="var(--blog-text)"
          ff="var(--blog-font-mono)"
          lh={1.2}
          style={{ letterSpacing: "-0.02em" }}
        >
          Categories
        </Text>
      </Flex>

      {/* Category list */}
      {categories.length === 0 ? (
        <Flex direction="column" align="center" py={60}>
          <Text fz="sm" c="var(--blog-text-faint)" ff="var(--blog-font-mono)">
            No categories yet.
          </Text>
        </Flex>
      ) : (
        <Flex direction="column">
          {categories.map((cat, i) => (
            <Flex key={cat.id} direction="column">
              <ActionButton
                anchorProps={{ underline: "never" }}
                href={`/category/${cat.slug}`}
                unstyled
                display="block"
                className="blog-category-item"
              >
                <Flex justify="space-between" align="center">
                  <Flex direction="column">
                    <Text
                      fw={700}
                      fz="1.1rem"
                      c="var(--blog-text)"
                      ff="var(--blog-font-mono)"
                      className="blog-post-title"
                      style={{ letterSpacing: "-0.01em" }}
                    >
                      {cat.name}
                    </Text>
                    {cat.description && (
                      <Text
                        fz="sm"
                        c="var(--blog-text-muted)"
                        lh={1.5}
                        mt={4}
                        lineClamp={2}
                      >
                        {cat.description}
                      </Text>
                    )}
                  </Flex>
                  <IconArrowRight
                    size={16}
                    color="var(--blog-text-faint)"
                    stroke={1.5}
                    className="blog-category-arrow"
                  />
                </Flex>
              </ActionButton>

              {i < categories.length - 1 && (
                <hr
                  className="blog-post-separator"
                  style={{ margin: "20px 0" }}
                />
              )}
            </Flex>
          ))}
        </Flex>
      )}
    </Flex>
  );
};

export default BlogCategories;
