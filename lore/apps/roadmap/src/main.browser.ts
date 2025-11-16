import { Alepha, run } from "alepha";
import { AlephaReactAuth } from "@alepha/react/auth";
import { AlephaReactForm } from "@alepha/react/form";
import { AppRouter } from "./AppRouter.ts";
import { currentAssignedTasksAtom } from "./atoms/currentAssignedTasksAtom.ts";
import { currentProjectAtom } from "./atoms/currentProjectAtom.ts";
import { currentProjectCharacterAtom } from "./atoms/currentProjectCharacterAtom.ts";
import { currentTaskAtom } from "./atoms/currentTaskAtom.ts";
import { userProjectsAtom } from "./atoms/userProjectsAtom.ts";
import { RoadmapServices } from "./services/index.ts";

const alepha = Alepha.create();

alepha.with(AlephaReactAuth);
alepha.with(AlephaReactForm);
alepha.with(RoadmapServices);

alepha.state.register(currentAssignedTasksAtom);
alepha.state.register(currentProjectAtom);
alepha.state.register(currentProjectCharacterAtom);
alepha.state.register(currentTaskAtom);
alepha.state.register(userProjectsAtom);

alepha.with(AppRouter);

run(alepha);
