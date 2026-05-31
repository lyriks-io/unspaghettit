import { systemClock, type Clock } from '$shared/domain/Clock';
import { cryptoIdGenerator, type IdGenerator } from '$shared/domain/IdGenerator';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { FeatureRepository } from '$features/behavior-model/application/ports/FeatureRepository';
import { createFeatureUseCase } from '$features/behavior-model/application/use-cases/CreateFeature';
import { deleteFeatureUseCase } from '$features/behavior-model/application/use-cases/DeleteFeature';
import { getFeatureUseCase } from '$features/behavior-model/application/use-cases/GetFeature';
import { getFeatureCardUseCase } from '$features/behavior-model/application/use-cases/GetFeatureCard';
import { listFeaturesUseCase } from '$features/behavior-model/application/use-cases/ListFeatures';
import { listFeaturesWithMaturityUseCase } from '$features/behavior-model/application/use-cases/ListFeaturesWithMaturity';
import { loadSamplesUseCase } from '$features/behavior-model/application/use-cases/LoadSamples';
import { saveFeatureUseCase } from '$features/behavior-model/application/use-cases/SaveFeature';
import { mutateFeatureUseCase } from '$features/behavior-model/application/use-cases/MutateFeature';
import { simulateActionUseCase } from '$features/simulator/application/use-cases/SimulateAction';
import { scoreFeatureUseCase } from '$features/maturity/application/use-cases/ScoreFeature';
import type { Project } from '$features/projects/domain/entities/Project';
import type { ProjectRepository } from '$features/projects/application/ports/ProjectRepository';
import { createProjectUseCase } from '$features/projects/application/use-cases/CreateProject';
import { deleteProjectUseCase } from '$features/projects/application/use-cases/DeleteProject';
import { getProjectUseCase } from '$features/projects/application/use-cases/GetProject';
import { listProjectsUseCase } from '$features/projects/application/use-cases/ListProjects';
import { saveProjectUseCase } from '$features/projects/application/use-cases/SaveProject';
import { addFeatureToProjectUseCase } from '$features/projects/application/use-cases/AddFeatureToProject';
import { removeFeatureFromProjectUseCase } from '$features/projects/application/use-cases/RemoveFeatureFromProject';
import { moveFeatureInProjectUseCase } from '$features/projects/application/use-cases/MoveFeatureInProject';
import { getProjectAggregateUseCase } from '$features/projects/application/use-cases/GetProjectAggregate';
import { findProjectContainingFeatureUseCase } from '$features/projects/application/use-cases/FindProjectContainingFeature';
import { enqueueQueueItemUseCase } from '$features/implementation-queue/application/use-cases/EnqueueQueueItem';
import { dequeueQueueItemUseCase } from '$features/implementation-queue/application/use-cases/DequeueQueueItem';
import { moveQueueItemUseCase } from '$features/implementation-queue/application/use-cases/MoveQueueItem';
import { listQueueUseCase } from '$features/implementation-queue/application/use-cases/ListQueue';
import { setQueueItemTargetUseCase } from '$features/implementation-queue/application/use-cases/SetQueueItemTarget';
import type { DomainRepository } from '$features/domains/application/ports/DomainRepository';
import { createDomainUseCase } from '$features/domains/application/use-cases/CreateDomain';
import { deleteDomainUseCase } from '$features/domains/application/use-cases/DeleteDomain';
import { getDomainUseCase } from '$features/domains/application/use-cases/GetDomain';
import { listDomainsUseCase } from '$features/domains/application/use-cases/ListDomains';
import { saveDomainUseCase } from '$features/domains/application/use-cases/SaveDomain';
import { addProjectToDomainUseCase } from '$features/domains/application/use-cases/AddProjectToDomain';
import { removeProjectFromDomainUseCase } from '$features/domains/application/use-cases/RemoveProjectFromDomain';
import type { ImplementationStatusRepository } from '$features/implementation-status/application/ports/ImplementationStatusRepository';
import type { TagPaletteRepository } from '$features/tag-palette/application/ports/TagPaletteRepository';
import type { TagOperations } from '$features/tag-palette/application/ports/TagOperations';
import { getTagPaletteUseCase } from '$features/tag-palette/application/use-cases/GetTagPalette';
import { setTagTypeColorUseCase } from '$features/tag-palette/application/use-cases/SetTagTypeColor';

export type Container = {
  readonly repository: FeatureRepository;
  readonly projectRepository: ProjectRepository;
  readonly domainRepository: DomainRepository;
  readonly statusRepository: ImplementationStatusRepository;
  readonly tagPaletteRepository: TagPaletteRepository;
  readonly tagOperations: TagOperations;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly useCases: {
    readonly createFeature: ReturnType<typeof createFeatureUseCase>;
    readonly saveFeature: ReturnType<typeof saveFeatureUseCase>;
    readonly mutateFeature: ReturnType<typeof mutateFeatureUseCase>;
    readonly deleteFeature: ReturnType<typeof deleteFeatureUseCase>;
    readonly listFeatures: ReturnType<typeof listFeaturesUseCase>;
    readonly listFeaturesWithMaturity: ReturnType<typeof listFeaturesWithMaturityUseCase>;
    readonly getFeature: ReturnType<typeof getFeatureUseCase>;
    readonly getFeatureCard: ReturnType<typeof getFeatureCardUseCase>;
    readonly loadSamples: ReturnType<typeof loadSamplesUseCase>;
    readonly simulateAction: ReturnType<typeof simulateActionUseCase>;
    readonly scoreFeature: ReturnType<typeof scoreFeatureUseCase>;
    readonly createProject: ReturnType<typeof createProjectUseCase>;
    readonly saveProject: ReturnType<typeof saveProjectUseCase>;
    readonly deleteProject: ReturnType<typeof deleteProjectUseCase>;
    readonly getProject: ReturnType<typeof getProjectUseCase>;
    readonly listProjects: ReturnType<typeof listProjectsUseCase>;
    readonly addFeatureToProject: ReturnType<typeof addFeatureToProjectUseCase>;
    readonly removeFeatureFromProject: ReturnType<typeof removeFeatureFromProjectUseCase>;
    readonly moveFeatureInProject: ReturnType<typeof moveFeatureInProjectUseCase>;
    readonly getProjectAggregate: ReturnType<typeof getProjectAggregateUseCase>;
    readonly findProjectContainingFeature: ReturnType<
      typeof findProjectContainingFeatureUseCase
    >;
    readonly createDomain: ReturnType<typeof createDomainUseCase>;
    readonly saveDomain: ReturnType<typeof saveDomainUseCase>;
    readonly deleteDomain: ReturnType<typeof deleteDomainUseCase>;
    readonly getDomain: ReturnType<typeof getDomainUseCase>;
    readonly listDomains: ReturnType<typeof listDomainsUseCase>;
    readonly addProjectToDomain: ReturnType<typeof addProjectToDomainUseCase>;
    readonly removeProjectFromDomain: ReturnType<typeof removeProjectFromDomainUseCase>;
    readonly enqueueQueueItem: ReturnType<typeof enqueueQueueItemUseCase>;
    readonly dequeueQueueItem: ReturnType<typeof dequeueQueueItemUseCase>;
    readonly moveQueueItem: ReturnType<typeof moveQueueItemUseCase>;
    readonly listQueue: ReturnType<typeof listQueueUseCase>;
    readonly setQueueItemTarget: ReturnType<typeof setQueueItemTargetUseCase>;
    readonly getTagPalette: ReturnType<typeof getTagPaletteUseCase>;
    readonly setTagTypeColor: ReturnType<typeof setTagTypeColorUseCase>;
    readonly renameTag: TagOperations['renameTag'];
  };
};

export const createContainer = (deps: {
  repository: FeatureRepository;
  projectRepository: ProjectRepository;
  domainRepository: DomainRepository;
  statusRepository: ImplementationStatusRepository;
  tagPaletteRepository: TagPaletteRepository;
  tagOperations: TagOperations;
  samples: readonly Feature[];
  projectSamples: readonly Project[];
  clock?: Clock;
  ids?: IdGenerator;
}): Container => {
  const clock = deps.clock ?? systemClock;
  const ids = deps.ids ?? cryptoIdGenerator;
  const repository = deps.repository;
  const projectRepository = deps.projectRepository;
  const domainRepository = deps.domainRepository;
  const statusRepository = deps.statusRepository;
  const tagPaletteRepository = deps.tagPaletteRepository;
  const tagOperations = deps.tagOperations;
  return {
    repository,
    projectRepository,
    domainRepository,
    statusRepository,
    tagPaletteRepository,
    tagOperations,
    clock,
    ids,
    useCases: {
      createFeature: createFeatureUseCase({ repository, clock, ids }),
      saveFeature: saveFeatureUseCase({ repository, clock }),
      mutateFeature: mutateFeatureUseCase({ repository, clock }),
      deleteFeature: deleteFeatureUseCase({ repository }),
      listFeatures: listFeaturesUseCase({ repository }),
      listFeaturesWithMaturity: listFeaturesWithMaturityUseCase({ repository, statusRepository }),
      getFeature: getFeatureUseCase({ repository }),
      getFeatureCard: getFeatureCardUseCase({ repository, statusRepository }),
      loadSamples: loadSamplesUseCase({
        repository,
        projectRepository,
        samples: deps.samples,
        projectSamples: deps.projectSamples
      }),
      simulateAction: simulateActionUseCase(),
      scoreFeature: scoreFeatureUseCase(),
      createProject: createProjectUseCase({ repository: projectRepository, clock, ids }),
      saveProject: saveProjectUseCase({ repository: projectRepository, clock }),
      deleteProject: deleteProjectUseCase({ repository: projectRepository }),
      getProject: getProjectUseCase({ repository: projectRepository }),
      listProjects: listProjectsUseCase({ repository: projectRepository }),
      addFeatureToProject: addFeatureToProjectUseCase({
        repository: projectRepository,
        clock
      }),
      removeFeatureFromProject: removeFeatureFromProjectUseCase({
        repository: projectRepository,
        clock
      }),
      moveFeatureInProject: moveFeatureInProjectUseCase({
        repository: projectRepository,
        clock
      }),
      getProjectAggregate: getProjectAggregateUseCase({
        projects: projectRepository,
        features: repository
      }),
      findProjectContainingFeature: findProjectContainingFeatureUseCase({
        repository: projectRepository
      }),
      createDomain: createDomainUseCase({ repository: domainRepository, clock, ids }),
      saveDomain: saveDomainUseCase({ repository: domainRepository, clock }),
      deleteDomain: deleteDomainUseCase({ repository: domainRepository }),
      getDomain: getDomainUseCase({ repository: domainRepository }),
      listDomains: listDomainsUseCase({ repository: domainRepository }),
      addProjectToDomain: addProjectToDomainUseCase({
        repository: domainRepository,
        clock
      }),
      removeProjectFromDomain: removeProjectFromDomainUseCase({
        repository: domainRepository,
        clock
      }),
      enqueueQueueItem: enqueueQueueItemUseCase({
        projects: projectRepository,
        features: repository,
        clock,
        ids
      }),
      dequeueQueueItem: dequeueQueueItemUseCase({
        projects: projectRepository,
        clock
      }),
      moveQueueItem: moveQueueItemUseCase({
        projects: projectRepository,
        clock
      }),
      listQueue: listQueueUseCase({
        projects: projectRepository,
        features: repository
      }),
      setQueueItemTarget: setQueueItemTargetUseCase({
        projects: projectRepository,
        clock
      }),
      getTagPalette: getTagPaletteUseCase({ repository: tagPaletteRepository }),
      setTagTypeColor: setTagTypeColorUseCase({ repository: tagPaletteRepository }),
      renameTag: (input) => tagOperations.renameTag(input)
    }
  };
};
