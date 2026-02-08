import { $module } from "alepha";
import { AppSecurity } from "./AppSecurity.ts";
import { AdminCategoryController } from "./controllers/AdminCategoryController.ts";
import { AdminCommentController } from "./controllers/AdminCommentController.ts";
import { AdminPostController } from "./controllers/AdminPostController.ts";
import { AdminSystemController } from "./controllers/AdminSystemController.ts";
import { CategoryController } from "./controllers/CategoryController.ts";
import { CommentController } from "./controllers/CommentController.ts";
import { PostController } from "./controllers/PostController.ts";
import { CategoryService } from "./services/CategoryService.ts";
import { CommentService } from "./services/CommentService.ts";
import { PostService } from "./services/PostService.ts";

export const ApiModule = $module({
  name: "blog.api",
  services: [
    AppSecurity,
    PostService,
    CommentService,
    CategoryService,
    PostController,
    AdminPostController,
    CommentController,
    AdminCommentController,
    CategoryController,
    AdminCategoryController,
    AdminSystemController,
  ],
});
