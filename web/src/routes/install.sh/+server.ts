import { redirect } from '@sveltejs/kit';

export function GET() {
    throw redirect(302, 'https://raw.githubusercontent.com/Abdulmumin1/chump/main/install.sh');
}
