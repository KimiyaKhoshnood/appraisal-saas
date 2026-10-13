import { Module, type OnModuleInit } from '@nestjs/common';
import { TenantExportRegistry } from '../../core';
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
export class EvaluationModule implements OnModuleInit {
  constructor(private readonly exportRegistry: TenantExportRegistry) {}

  /** Tables this module owns, for the tenant data export. */
  onModuleInit(): void {
    const registry = this.exportRegistry;
    registry.register({ module: 'evaluation', table: 'evaluation_cycle' });
    registry.register({ module: 'evaluation', table: 'competency' });
    registry.register({ module: 'evaluation', table: 'evaluation' });
    registry.register({ module: 'evaluation', table: 'evaluation_score' });
    registry.register({ module: 'evaluation', table: 'approval_record' });
  }
}

export { EvaluationReadModel, type CycleStats } from './evaluation-read-model';
