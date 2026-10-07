import { Module } from '@nestjs/common';
import { ConfigurationModule } from '../configuration';
import { OrganizationModule } from '../organization';
import { CyclesService } from './cycles.service';
import { CyclesController, EvaluationsController, TeamController } from './evaluation.controller';
import { EvaluationReadModel } from './evaluation-read-model';
import { EvaluationsService } from './evaluations.service';

/** evaluation: cycles, competencies, evaluations, scores, approvals. Depends on: configuration, organization, audit. */
@Module({
  imports: [ConfigurationModule, OrganizationModule],
  controllers: [CyclesController, EvaluationsController, TeamController],
  providers: [CyclesService, EvaluationsService, EvaluationReadModel],
  exports: [EvaluationReadModel],
})
export class EvaluationModule {}

export { EvaluationReadModel, type CycleStats } from './evaluation-read-model';
