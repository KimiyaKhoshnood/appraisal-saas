import { Controller, Get, HttpCode, Post, Put, UseInterceptors } from '@nestjs/common';
import {
  approvalDecisionSchema,
  createCycleSchema,
  listEvaluationsQuerySchema,
  rejectionSchema,
  replaceCompetenciesSchema,
  saveScoresSchema,
  type CreateCycleInput,
  type ListEvaluationsQuery,
  type ReplaceCompetenciesInput,
  type SaveScoresInput,
} from '@appraisal/contracts';
import { z } from 'zod';
import { Authenticated, IdParam, IfMatch, RequirePermission, TenantContext, ValidBody, ValidQuery, VersionETagInterceptor } from '../../core';
import { CyclesService } from './cycles.service';
import { EvaluationReadModel } from './evaluation-read-model';
import { EvaluationsService } from './evaluations.service';

const optionalScores = saveScoresSchema.partial().strict();

@Controller('cycles')
export class CyclesController {
  constructor(private readonly cycles: CyclesService) {}

  @Get()
  @RequirePermission('cycle:read')
  list() {
    return this.cycles.list();
  }

  @Get(':id')
  @RequirePermission('cycle:read')
  get(@IdParam() id: string) {
    return this.cycles.get(id);
  }

  @Post()
  @RequirePermission('cycle:write')
  create(@ValidBody(createCycleSchema) body: CreateCycleInput) {
    return this.cycles.create(body);
  }

  @Put(':id/competencies')
  @RequirePermission('cycle:write')
  replaceCompetencies(@IdParam() id: string, @ValidBody(replaceCompetenciesSchema) body: ReplaceCompetenciesInput) {
    return this.cycles.replaceCompetencies(id, body);
  }

  @Post(':id/activate')
  @HttpCode(200)
  @RequirePermission('cycle:write')
  activate(@IdParam() id: string) {
    return this.cycles.activate(id);
  }

  @Post(':id/close')
  @HttpCode(200)
  @RequirePermission('cycle:write')
  close(@IdParam() id: string) {
    return this.cycles.close(id);
  }
}

/**
 * Evaluation actions are @Authenticated rather than permission-gated at the route: whether you
 * may act depends on the record (your own? your report's?), which only the service can decide.
 * The service still checks the matching permission (evaluation:self / manage / approve).
 *
 * Single-evaluation responses carry an ETag; every write honours `If-Match` (412 when stale).
 */
@Controller('evaluations')
@UseInterceptors(VersionETagInterceptor)
export class EvaluationsController {
  constructor(private readonly evaluations: EvaluationsService) {}

  @Get()
  @Authenticated()
  list(@ValidQuery(listEvaluationsQuerySchema) q: ListEvaluationsQuery) {
    return this.evaluations.list(q);
  }

  @Get(':id')
  @Authenticated()
  get(@IdParam() id: string) {
    return this.evaluations.get(id);
  }

  @Put(':id/self-scores')
  @Authenticated()
  saveSelf(@IdParam() id: string, @ValidBody(saveScoresSchema) body: SaveScoresInput, @IfMatch() version?: number) {
    return this.evaluations.saveScores(id, 'SELF', body, version);
  }

  @Post(':id/self-submit')
  @HttpCode(200)
  @Authenticated()
  submitSelf(@IdParam() id: string, @ValidBody(optionalScores) body: Partial<SaveScoresInput>, @IfMatch() version?: number) {
    return this.evaluations.submit(id, 'SELF', body.scores ? { scores: body.scores } : undefined, version);
  }

  @Put(':id/manager-scores')
  @Authenticated()
  saveManager(@IdParam() id: string, @ValidBody(saveScoresSchema) body: SaveScoresInput, @IfMatch() version?: number) {
    return this.evaluations.saveScores(id, 'MANAGER', body, version);
  }

  @Post(':id/manager-submit')
  @HttpCode(200)
  @Authenticated()
  submitManager(@IdParam() id: string, @ValidBody(optionalScores) body: Partial<SaveScoresInput>, @IfMatch() version?: number) {
    return this.evaluations.submit(id, 'MANAGER', body.scores ? { scores: body.scores } : undefined, version);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermission('evaluation:approve')
  approve(@IdParam() id: string, @ValidBody(approvalDecisionSchema) body: z.infer<typeof approvalDecisionSchema>, @IfMatch() version?: number) {
    return this.evaluations.approve(id, body.comment, version);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequirePermission('evaluation:approve')
  reject(@IdParam() id: string, @ValidBody(rejectionSchema) body: z.infer<typeof rejectionSchema>, @IfMatch() version?: number) {
    return this.evaluations.reject(id, body.reason, version);
  }
}

@Controller()
export class TeamController {
  constructor(
    private readonly evaluations: EvaluationsService,
    private readonly readModel: EvaluationReadModel,
  ) {}

  /** EV-07 */
  @Get('employees/:id/evaluations')
  @Authenticated()
  history(@IdParam() id: string) {
    return this.evaluations.history(id);
  }

  /** EV-08 */
  @Get('team/dashboard')
  @RequirePermission('evaluation:manage')
  dashboard() {
    return this.readModel.teamDashboard(TenantContext.requireAccess().user.id);
  }
}
