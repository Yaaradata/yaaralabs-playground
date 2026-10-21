import AuthForm from '../../../components/Admin/AuthForm';

export const metadata = { title: 'Admin login' };

export default function AdminLoginPage() {
  return <AuthForm mode="login" />;
}
