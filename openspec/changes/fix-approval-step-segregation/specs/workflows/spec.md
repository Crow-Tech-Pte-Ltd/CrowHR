## MODIFIED Requirements
### Requirement: Approver resolution and fallback
When a step resolves to the requester themselves, to nobody (for example, no manager), or to a suspended or former member, the step SHALL be skipped and recorded as `skipped` with the reason. If every step is skipped, the request SHALL go to hr_admins. For `payroll_run`, and when the requester is the only hr_admin, it SHALL go to owners. If no eligible member other than the requester exists, an owner who is the requester SHALL be allowed to decide, and the decision SHALL be marked `self_approved`. A request SHALL never be approved without a recorded decision by a member.

A member who approved a step of a request, as assignee or as a delegate, SHALL NOT be given or decide a later step of that request, whether through the step's rule, delegation, escalation or reassignment. When only such members match a later step's rule, the step SHALL go to eligible hr_admins and then owners who have not approved the request (owners only for a role step, `payroll_run` or a bank change). When no other member may decide it, the earlier approver SHALL decide that step too, and the task and its decision SHALL be marked `repeat_approval`.

#### Scenario: Employee without manager
- **WHEN** an employee with no manager submits leave under the default policy
- **THEN** the manager step is skipped with reason `no_manager` and the hr_admins receive the task

#### Scenario: Manager applies for own leave
- **WHEN** a department head whose manager is the owner submits leave
- **THEN** the owner receives the task, and the department head cannot approve it themselves

#### Scenario: Manager who is also an HR admin
- **WHEN** a manager who holds hr_admin approves the manager step of a claim under the default manager-then-hr_admin chain
- **THEN** the hr_admin step's tasks go to the other hr_admins only, and the manager's decision on that step is refused with 403

#### Scenario: Nobody else may decide
- **WHEN** the owner is the employee's manager, the only hr_admin and the only owner, and approves the manager step of a claim
- **THEN** the owner also receives the hr_admin step, marked `repeat_approval`, and its decision is recorded in the audit log with `repeatApproval: true`
