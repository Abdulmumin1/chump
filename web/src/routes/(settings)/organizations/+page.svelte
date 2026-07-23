<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { addToast } from '$lib/toast-store.svelte';
	import type { PageProps } from './$types';
	import {
		acceptOrganizationInvitation,
		addTeamMember,
		cancelOrganizationInvitation,
		changeMemberRole,
		createOrganization,
		createTeam,
		deleteTeam,
		getOrganizationInvitation,
		getOrganizationWorkspace,
		inviteOrganizationMember,
		rejectOrganizationInvitation,
		removeOrganizationMember,
		removeTeamMember,
		selectOrganization,
		selectTeam,
		updateOrganizationName,
		type MemberView,
		type MutationResult,
		type TeamView
	} from './organizations.remote';

	let { data }: PageProps = $props();
	const workspaceQuery = getOrganizationWorkspace();
	let invitationQuery = $derived(
		data.invitationId ? getOrganizationInvitation(data.invitationId) : null
	);
	let workspace = $derived(await workspaceQuery);
	let invitationLookup = $derived(invitationQuery ? await invitationQuery : null);
	let invitationDismissed = $state(false);
	let teamMemberUserId = $state('');
	let pendingAction = $state('');
	let isEditingName = $state(false);
	let editedName = $state('');

	const currentTab = $derived(page.url.searchParams.get('tab') ?? 'overview');

	let activeOrganization = $derived(
		workspace.organizations.find(
			(organization) => organization.id === workspace.activeOrganizationId
		) ?? null
	);
	let otherOrganizations = $derived(
		workspace.organizations.filter(
			(organization) => organization.id !== workspace.activeOrganizationId
		)
	);
	let activeTeam = $derived(
		workspace.teams.find((team) => team.id === workspace.activeTeamId) ?? null
	);
	let canManage = $derived(
		workspace.activeRole === 'owner' || workspace.activeRole === 'admin'
	);
	let isOwner = $derived(workspace.activeRole === 'owner');
	let availableTeamMembers = $derived(
		workspace.members.filter(
			(member) =>
				!workspace.teamMembers.some((teamMember) => teamMember.userId === member.userId)
		)
	);
	let newInvitationLink = $derived(
		inviteOrganizationMember.result?.invitationId
			? invitationLink(inviteOrganizationMember.result.invitationId)
			: ''
	);

	type FormController = {
		form: HTMLFormElement;
		submit: () => Promise<boolean>;
	};

	async function submitAndReset(form: FormController): Promise<void> {
		const submitted = await form.submit();
		if (submitted) {
			form.form.reset();
			addToast('Created successfully.', 'success');
		}
	}

	async function runCommand(
		action: string,
		operation: () => Promise<MutationResult>
	): Promise<boolean> {
		pendingAction = action;
		const result = await operation().then(
			(value) => value,
			() => ({ ok: false as const, message: 'The request failed. Please try again.' })
		);
		pendingAction = '';
		if (!result.ok) {
			addToast(result.message, 'error');
			return false;
		}
		addToast(result.message, 'success');
		return true;
	}

	function startEditingName() {
		if (!activeOrganization) return;
		editedName = activeOrganization.name;
		isEditingName = true;
	}

	function cancelEditingName() {
		isEditingName = false;
	}

	async function saveOrganizationName() {
		if (!activeOrganization || !editedName.trim()) return;
		if (editedName.trim() === activeOrganization.name) {
			isEditingName = false;
			return;
		}
		const updated = await runCommand('update-org-name', () =>
			updateOrganizationName({
				organizationId: activeOrganization.id,
				name: editedName.trim()
			})
		);
		if (updated) {
			isEditingName = false;
		}
	}

	async function chooseOrganization(organizationId: string): Promise<void> {
		if (organizationId === workspace.activeOrganizationId) return;
		await runCommand(`organization:${organizationId}`, () => selectOrganization(organizationId));
	}

	async function chooseTeam(teamId: string | null): Promise<void> {
		await runCommand('select-team', () => selectTeam(teamId));
	}

	async function removeTeam(team: TeamView): Promise<void> {
		if (!confirm(`Delete the ${team.name} team?`)) return;
		await runCommand(`remove-team:${team.id}`, () => deleteTeam(team.id));
	}

	async function addMemberToActiveTeam(): Promise<void> {
		if (!workspace.activeTeamId || !teamMemberUserId) return;
		const added = await runCommand('add-team-member', () =>
			addTeamMember({ teamId: workspace.activeTeamId!, userId: teamMemberUserId })
		);
		if (added) teamMemberUserId = '';
	}

	async function removeMemberFromActiveTeam(member: MemberView): Promise<void> {
		if (!workspace.activeTeamId) return;
		await runCommand(`remove-team-member:${member.userId}`, () =>
			removeTeamMember({ teamId: workspace.activeTeamId!, userId: member.userId })
		);
	}

	async function updateMemberRole(
		member: MemberView,
		role: 'member' | 'admin'
	): Promise<void> {
		await runCommand(`role:${member.id}`, () =>
			changeMemberRole({ memberId: member.id, role })
		);
	}

	async function removeMember(member: MemberView): Promise<void> {
		if (!confirm(`Remove ${member.user.name} from this organization?`)) return;
		await runCommand(`remove:${member.id}`, () => removeOrganizationMember(member.id));
	}

	async function cancelInvitation(invitationId: string): Promise<void> {
		await runCommand(`cancel:${invitationId}`, () =>
			cancelOrganizationInvitation(invitationId)
		);
	}

	async function acceptInvitation(invitationId: string): Promise<void> {
		const accepted = await runCommand('accept-invitation', () =>
			acceptOrganizationInvitation(invitationId)
		);
		if (accepted) await goto(resolve(data.redirectTo));
	}

	async function rejectInvitation(invitationId: string): Promise<void> {
		const rejected = await runCommand('reject-invitation', () =>
			rejectOrganizationInvitation(invitationId)
		);
		if (rejected) invitationDismissed = true;
	}

	function invitationLink(invitationId: string): string {
		return `${page.url.origin}${resolve('/organizations')}?invitationId=${encodeURIComponent(invitationId)}`;
	}

	async function copyText(value: string): Promise<void> {
		const copied = await navigator.clipboard.writeText(value).then(
			() => true,
			() => false
		);
		if (copied) addToast('Copied to clipboard.', 'success');
		else addToast('The browser could not copy to clipboard.', 'error');
	}

	function suggestSlug(): void {
		if (createOrganization.fields.slug.value()) return;
		const name = createOrganization.fields.name.value() ?? '';
		createOrganization.fields.slug.set(
			name
				.toLowerCase()
				.trim()
				.replace(/[^a-z0-9]+/g, '-')
				.replace(/(^-|-$)/g, '')
		);
	}
</script>

<svelte:head>
	<title>General · Chump</title>
	<meta name="description" content="Manage your Chump organization and teams" />
</svelte:head>

<div class="space-y-8">
	<!-- Page Header -->
	<div>
		<h1 class="text-2xl font-bold tracking-tight text-text-inverse sm:text-3xl">
			General
		</h1>
		<p class="mt-1 text-sm text-text-tertiary">
			Manage your organization details, workspace settings, and active context.
		</p>
	</div>

	<!-- Organization Invitation Banner -->
	{#if invitationLookup && !invitationDismissed}
		{#if invitationLookup.ok}
			{@const invitation = invitationLookup.invitation}
			<section class="rounded-2xl border border-accent/40 bg-accent/5 p-5">
				<p class="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">
					Organization Invitation
				</p>
				<h2 class="mt-1 text-lg font-semibold text-text-inverse">
					Join {invitation.organizationName}
				</h2>
				<p class="mt-1 text-xs text-text-secondary">
					{invitation.inviterEmail} invited {data.user.email} as {invitation.role}.
				</p>
				<div class="mt-4 flex gap-3">
					<button
						class="button-primary"
						disabled={pendingAction === 'accept-invitation'}
						onclick={() => void acceptInvitation(invitation.id)}
					>
						Accept invitation
					</button>
					<button
						class="button-secondary"
						disabled={pendingAction === 'reject-invitation'}
						onclick={() => void rejectInvitation(invitation.id)}
					>
						Decline
					</button>
				</div>
			</section>
		{:else}
			<p class="rounded-xl bg-bg-toast-err px-4 py-3 text-sm text-text-error" role="alert">
				{invitationLookup.message}
			</p>
		{/if}
	{/if}

	<!-- TAB: OVERVIEW / GENERAL -->
	{#if currentTab === 'overview'}
		<div class="space-y-8 max-w-4xl">
			{#if activeOrganization}
				<div>
					<h2 class="text-sm font-semibold tracking-wide text-text-inverse uppercase mb-3">
						Organization
					</h2>

					<!-- Single Clean Card matching Devin UI -->
					<div class="rounded-2xl border border-border-default bg-bg-surface divide-y divide-border-default shadow-xs overflow-hidden">
						<!-- Row 1: Organization Name -->
						<div class="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
							<div>
								<h3 class="text-sm font-medium text-text-main">Organization name</h3>
								<p class="text-xs text-text-tertiary mt-0.5">
									The name shown across Chump and in workspace notifications
								</p>
							</div>
							<div class="flex items-center gap-2 shrink-0">
								{#if isEditingName}
									<form
										class="flex items-center gap-2"
										onsubmit={(event) => {
											event.preventDefault();
											void saveOrganizationName();
										}}
									>
										<input
											type="text"
											bind:value={editedName}
											class="field px-3 py-1.5 text-xs font-semibold text-text-inverse w-48"
											placeholder="Workspace name"
											required
											maxlength="80"
										/>
										<button
											type="submit"
											class="button-primary text-xs px-3 py-1.5 shrink-0"
											disabled={pendingAction === 'update-org-name'}
										>
											Save
										</button>
										<button
											type="button"
											class="button-secondary text-xs px-3 py-1.5 shrink-0"
											onclick={cancelEditingName}
										>
											Cancel
										</button>
									</form>
								{:else}
									<div class="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-bg-input border border-border-default">
										<span class="grid size-6 place-items-center rounded bg-bg-surface font-mono text-[10px] font-bold uppercase text-accent">
											{activeOrganization.name.slice(0, 2)}
										</span>
										<span class="text-xs font-semibold text-text-inverse">{activeOrganization.name}</span>
										{#if canManage}
											<button
												type="button"
												class="ml-1 text-text-tertiary hover:text-text-main transition-colors p-0.5"
												title="Edit workspace name"
												aria-label="Edit workspace name"
												onclick={startEditingName}
											>
												<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
													<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
												</svg>
											</button>
										{/if}
									</div>
									{#if workspace.activeRole}
										<span class="rounded-full bg-accent/15 px-2.5 py-1 font-mono text-[10px] uppercase text-accent font-semibold tracking-wider">
											{workspace.activeRole}
										</span>
									{/if}
								{/if}
							</div>
						</div>

						<!-- Row 2: Organization ID / Slug -->
						<div class="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
							<div>
								<h3 class="text-sm font-medium text-text-main">Organization ID</h3>
								<p class="text-xs text-text-tertiary mt-0.5">
									Your unique organization identifier for API and workspace sessions
								</p>
							</div>
							<div class="flex items-center gap-2 shrink-0">
								<div class="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-bg-input border border-border-default font-mono text-xs text-text-secondary">
									<span>{activeOrganization.slug}</span>
									<button
										type="button"
										class="text-text-tertiary hover:text-text-main transition-colors p-0.5"
										title="Copy Organization ID"
										onclick={() => void copyText(activeOrganization.slug)}
									>
										<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
										</svg>
									</button>
								</div>
							</div>
						</div>

						<!-- Row 3: Active Team -->
						<div class="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
							<div>
								<h3 class="text-sm font-medium text-text-main">Active Team</h3>
								<p class="text-xs text-text-tertiary mt-0.5">
									Select a team context for active authorization
								</p>
							</div>
							<div class="shrink-0 w-full sm:w-auto">
								<select
									class="field min-w-[14rem] text-xs font-medium"
									value={workspace.activeTeamId ?? ''}
									onchange={(event) => void chooseTeam(event.currentTarget.value || null)}
								>
									<option value="">All teams ({workspace.teams.length})</option>
									{#each workspace.teams as team (team.id)}
										<option value={team.id}>{team.name}</option>
									{/each}
								</select>
							</div>
						</div>

						<!-- Row 4: Launch Workspace -->
						<div class="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
							<div>
								<h3 class="text-sm font-medium text-text-main">Launch Workspace</h3>
								<p class="text-xs text-text-tertiary mt-0.5">
									Return to the Chump main agent interface with this active context
								</p>
							</div>
							<div class="shrink-0">
								<a href={resolve(data.redirectTo)} class="button-primary text-xs">
									Continue to Chump →
								</a>
							</div>
						</div>
					</div>
				</div>

				<!-- Other Organizations (ONLY rendered if user has more than 1 organization) -->
				{#if otherOrganizations.length > 0}
					<div>
						<h2 class="text-sm font-semibold tracking-wide text-text-inverse uppercase mb-3">
							Switch Organization
						</h2>
						<div class="rounded-2xl border border-border-default bg-bg-surface divide-y divide-border-default shadow-xs overflow-hidden">
							{#each otherOrganizations as organization (organization.id)}
								<div class="p-4 flex items-center justify-between gap-4">
									<div class="flex items-center gap-3 min-w-0">
										<span class="grid size-8 shrink-0 place-items-center rounded-lg bg-bg-input font-mono text-xs font-semibold uppercase text-text-main border border-border-default">
											{organization.name.slice(0, 2)}
										</span>
										<div class="min-w-0">
											<strong class="block truncate text-sm font-medium text-text-main">{organization.name}</strong>
											<span class="block truncate text-xs font-mono text-text-tertiary">{organization.slug}</span>
										</div>
									</div>
									<button
										class="button-secondary text-xs shrink-0"
										disabled={pendingAction === `organization:${organization.id}`}
										onclick={() => void chooseOrganization(organization.id)}
									>
										Switch
									</button>
								</div>
							{/each}
						</div>
					</div>
				{/if}
			{:else}
				<section class="rounded-2xl border border-dashed border-border-default bg-bg-surface p-10 text-center">
					<h2 class="text-lg font-semibold text-text-inverse">Create an organization to continue</h2>
					<p class="mx-auto mt-2 max-w-md text-xs text-text-tertiary">
						Every Chump Web workspace belongs to an organization. Create one below to get started.
					</p>
					<form
						class="mx-auto mt-6 max-w-sm space-y-3 text-left"
						{...createOrganization.enhance(submitAndReset)}
					>
						<label class="block">
							<span class="mb-1 block text-xs text-text-secondary">Name</span>
							<input
								{...createOrganization.fields.name.as('text')}
								class="field"
								onblur={suggestSlug}
								maxlength="80"
								placeholder="Acme Inc."
							/>
						</label>
						<label class="block">
							<span class="mb-1 block text-xs text-text-secondary">Slug</span>
							<input
								{...createOrganization.fields.slug.as('text')}
								class="field font-mono text-xs"
								maxlength="64"
								placeholder="acme"
							/>
						</label>
						<button class="button-primary w-full text-xs" disabled={createOrganization.pending > 0}>
							Create Organization
						</button>
					</form>
				</section>
			{/if}
		</div>
	{/if}

	<!-- TAB: TEAMS -->
	{#if currentTab === 'teams'}
		<div class="space-y-6">
			<section class="rounded-2xl border border-border-default bg-bg-surface p-6">
				<div class="flex items-center justify-between pb-4 border-b border-border-default">
					<div>
						<h2 class="text-base font-semibold text-text-inverse">Teams</h2>
						<p class="mt-0.5 text-xs text-text-tertiary">
							First-class groups within {activeOrganization?.name ?? 'this organization'}.
						</p>
					</div>
					<span class="text-xs font-mono text-text-tertiary">{workspace.teams.length} total</span>
				</div>

				{#if workspace.teams.length > 0}
					<div class="mt-4 grid gap-3 sm:grid-cols-2">
						{#each workspace.teams as team (team.id)}
							{@const isActiveTeam = team.id === workspace.activeTeamId}
							<div
								class="flex items-center justify-between rounded-xl border p-4 transition-colors"
								class:border-accent={isActiveTeam}
								class:bg-bg-hover={isActiveTeam}
								class:border-border-default={!isActiveTeam}
								class:hover:bg-bg-hover={!isActiveTeam}
							>
								<button class="min-w-0 flex-1 text-left" onclick={() => void chooseTeam(team.id)}>
									<strong class="block truncate text-sm font-medium text-text-main">{team.name}</strong>
									<span class="mt-0.5 block text-xs font-mono text-text-tertiary">
										{isActiveTeam ? 'Active Team' : 'Select Team'}
									</span>
								</button>
								{#if canManage}
									<button
										class="ml-3 text-xs text-text-error hover:underline shrink-0"
										aria-label={`Delete ${team.name}`}
										onclick={() => void removeTeam(team)}
									>
										Delete
									</button>
								{/if}
							</div>
						{/each}
					</div>
				{:else}
					<p class="py-6 text-center text-xs text-text-tertiary">No teams created yet.</p>
				{/if}

				{#if canManage}
					<div class="mt-6 pt-5 border-t border-border-default">
						<h3 class="text-xs font-medium text-text-secondary">Create a New Team</h3>
						<form class="mt-2 flex gap-2" {...createTeam.enhance(submitAndReset)}>
							<input
								{...createTeam.fields.name.as('text')}
								class="field"
								maxlength="80"
								placeholder="e.g. Engineering, Product, Design"
								aria-label="New team name"
							/>
							<button class="button-secondary shrink-0 text-xs" disabled={createTeam.pending > 0}>Add Team</button>
						</form>
						{#each createTeam.fields.allIssues() ?? [] as issue (issue.message)}
							<p class="mt-2 text-xs text-text-error">{issue.message}</p>
						{/each}
					</div>
				{/if}
			</section>

			{#if activeTeam}
				<section class="rounded-2xl border border-border-default bg-bg-surface p-6">
					<h3 class="text-sm font-semibold text-text-inverse">{activeTeam.name} Members</h3>
					<p class="mt-0.5 text-xs text-text-tertiary">Members assigned to the active team.</p>

					{#if workspace.teamMembers.length === 0}
						<p class="mt-3 text-xs text-text-tertiary">No members are assigned to this team.</p>
					{:else}
						<div class="mt-3 flex flex-wrap gap-2">
							{#each workspace.teamMembers as teamMember (teamMember.id)}
								{@const member = workspace.members.find((item) => item.userId === teamMember.userId)}
								{#if member}
									<span class="inline-flex items-center gap-2 rounded-lg bg-bg-input px-3 py-1.5 text-xs text-text-secondary border border-border-default">
										<span class="font-medium text-text-main">{member.user.name}</span>
										{#if canManage}
											<button
												class="text-text-error hover:text-text-main transition-colors ml-1"
												aria-label={`Remove ${member.user.name} from ${activeTeam.name}`}
												onclick={() => void removeMemberFromActiveTeam(member)}
											>
												×
											</button>
										{/if}
									</span>
								{/if}
							{/each}
						</div>
					{/if}

					{#if canManage && availableTeamMembers.length > 0}
						<form
							class="mt-4 flex gap-2 max-w-md"
							onsubmit={(event) => {
								event.preventDefault();
								void addMemberToActiveTeam();
							}}
						>
							<select class="field text-xs" bind:value={teamMemberUserId} required aria-label="Organization member">
								<option value="" disabled>Add an organization member…</option>
								{#each availableTeamMembers as member (member.id)}
									<option value={member.userId}>{member.user.name} · {member.user.email}</option>
								{/each}
							</select>
							<button class="button-secondary shrink-0 text-xs" disabled={pendingAction === 'add-team-member'}>Add</button>
						</form>
					{/if}
				</section>
			{/if}
		</div>
	{/if}

	<!-- TAB: MEMBERS -->
	{#if currentTab === 'members'}
		<section class="rounded-2xl border border-border-default bg-bg-surface p-6">
			<div class="flex items-center justify-between pb-4 border-b border-border-default">
				<div>
					<h2 class="text-base font-semibold text-text-inverse">Organization Members</h2>
					<p class="mt-0.5 text-xs text-text-tertiary">Roles apply across the entire organization.</p>
				</div>
				<span class="rounded-full bg-bg-input border border-border-default px-2.5 py-1 font-mono text-xs text-text-secondary">
					Your role: {workspace.activeRole}
				</span>
			</div>

			<div class="mt-2 divide-y divide-border-default">
				{#each workspace.members as member (member.id)}
					<div class="flex flex-wrap items-center justify-between gap-4 py-3.5">
						<div class="flex items-center gap-3 min-w-0">
							{#if member.user.image}
								<img src={member.user.image} alt={member.user.name} class="size-9 rounded-full object-cover shrink-0 border border-border-default" />
							{:else}
								<span class="grid size-9 place-items-center rounded-full bg-bg-input text-xs font-semibold uppercase text-text-inverse border border-border-default">
									{member.user.name.slice(0, 2)}
								</span>
							{/if}
							<div class="min-w-0">
								<strong class="block truncate text-sm font-medium text-text-main">
									{member.user.name}{member.userId === data.user.id ? ' (you)' : ''}
								</strong>
								<span class="block truncate text-xs text-text-tertiary">{member.user.email}</span>
							</div>
						</div>

						<div class="flex items-center gap-3">
							{#if canManage && member.role !== 'owner' && member.userId !== data.user.id}
								<select
									class="rounded-lg border border-border-default bg-bg-input px-2.5 py-1.5 text-xs text-text-main"
									value={member.role}
									onchange={(event) => void updateMemberRole(member, event.currentTarget.value as 'member' | 'admin')}
								>
									<option value="member">Member</option>
									<option value="admin">Admin</option>
								</select>
								<button
									class="text-xs text-text-error hover:underline"
									onclick={() => void removeMember(member)}
								>
									Remove
								</button>
							{:else}
								<span class="rounded-full bg-bg-input border border-border-default px-2.5 py-1 text-xs font-mono capitalize text-text-secondary">
									{member.role}
								</span>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		</section>
	{/if}

	<!-- TAB: INVITATIONS -->
	{#if currentTab === 'invitations'}
		<div class="space-y-6">
			{#if canManage}
				<section class="rounded-2xl border border-border-default bg-bg-surface p-6">
					<h2 class="text-base font-semibold text-text-inverse">Invite a Member</h2>
					<p class="mt-0.5 text-xs text-text-tertiary">
						Send an invitation to grant access to {activeOrganization?.name ?? 'this organization'}.
					</p>

					<form
						class="mt-4 grid gap-3 sm:grid-cols-[1fr_8rem_10rem_auto]"
						{...inviteOrganizationMember.enhance(submitAndReset)}
					>
						<input
							{...inviteOrganizationMember.fields.email.as('email')}
							class="field text-xs"
							placeholder="colleague@example.com"
							aria-label="Email address"
						/>
						<select
							{...inviteOrganizationMember.fields.role.as('select', 'member')}
							class="field text-xs"
							aria-label="Role"
						>
							<option value="member">Member</option>
							{#if isOwner}<option value="admin">Admin</option>{/if}
						</select>
						<select
							{...inviteOrganizationMember.fields.teamId.as('select', '')}
							class="field text-xs"
							aria-label="Initial team"
						>
							<option value="">No team</option>
							{#each workspace.teams as team (team.id)}
								<option value={team.id}>{team.name}</option>
							{/each}
						</select>
						<button class="button-primary text-xs" disabled={inviteOrganizationMember.pending > 0}>Invite</button>
					</form>

					{#each inviteOrganizationMember.fields.allIssues() ?? [] as issue (issue.message)}
						<p class="mt-2 text-xs text-text-error">{issue.message}</p>
					{/each}

					{#if newInvitationLink}
						<div class="mt-4 p-3 rounded-xl bg-accent/10 border border-accent/30 space-y-2">
							<p class="text-xs font-medium text-accent">Invitation Generated</p>
							<div class="flex gap-2">
								<input class="field font-mono text-xs bg-bg-input" value={newInvitationLink} readonly aria-label="New invitation link" />
								<button class="button-secondary shrink-0 text-xs" onclick={() => void copyText(newInvitationLink)}>Copy Link</button>
							</div>
						</div>
					{/if}
				</section>
			{/if}

			<section class="rounded-2xl border border-border-default bg-bg-surface p-6">
				<h3 class="text-sm font-semibold text-text-inverse">Pending Invitations</h3>
				<p class="mt-0.5 text-xs text-text-tertiary">Active invitation links sent to new members.</p>

				{#if workspace.invitations.filter((invitation) => invitation.status === 'pending').length === 0}
					<p class="py-6 text-center text-xs text-text-tertiary">No pending invitations.</p>
				{:else}
					<div class="mt-3 divide-y divide-border-default">
						{#each workspace.invitations.filter((invitation) => invitation.status === 'pending') as invitation (invitation.id)}
							<div class="flex items-center justify-between gap-3 py-3">
								<div>
									<strong class="block text-sm font-medium text-text-main">{invitation.email}</strong>
									<span class="block text-xs font-mono text-text-tertiary">Role: {invitation.role}</span>
								</div>
								<div class="flex items-center gap-3">
									<button class="text-xs text-accent hover:underline" onclick={() => void copyText(invitationLink(invitation.id))}>
										Copy Link
									</button>
									{#if canManage}
										<button class="text-xs text-text-error hover:underline" onclick={() => void cancelInvitation(invitation.id)}>
											Cancel
										</button>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</section>
		</div>
	{/if}
</div>

<style>
	:global(.field) {
		width: 100%;
		border-radius: 0.75rem;
		border: 1px solid var(--color-border-default);
		background: var(--color-bg-input);
		color: var(--color-text-main);
		padding: 0.5rem 0.75rem;
		font-size: 0.875rem;
		outline: none;
		transition: border-color 0.15s ease;
	}
	:global(.field:focus) {
		border-color: var(--color-accent);
	}
	:global(.button-primary),
	:global(.button-secondary) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 0.75rem;
		padding: 0.5rem 1rem;
		font-size: 0.875rem;
		font-weight: 600;
		transition: opacity 0.15s ease, background-color 0.15s ease;
	}
	:global(.button-primary) {
		background: var(--color-accent);
		color: var(--color-text-on-accent);
	}
	:global(.button-primary:hover) {
		opacity: 0.9;
	}
	:global(.button-secondary) {
		border: 1px solid var(--color-border-default);
		background: var(--color-bg-surface);
		color: var(--color-text-main);
	}
	:global(.button-secondary:hover) {
		background: var(--color-bg-hover);
	}
</style>
