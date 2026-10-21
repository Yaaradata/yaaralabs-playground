import AuthForm from '../../../components/Admin/AuthForm';

export const metadata = { title: 'Admin signup' };

export default function AdminSignupPage() {
  return <AuthForm mode="signup" />;
}
