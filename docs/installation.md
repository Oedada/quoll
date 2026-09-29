## Установка
Для установки подойдёт только linux, для запуска сисетмы требуются:
- docker
- docker compose
- python(необязателен, используется для генерации ключа в команде) 
- git
После установки всего необходимого требуется выполнить следующие команды:
```bash
git clone https://github.com/Oedada/quoll.git
cd quoll
cp backend/example.env backend/.env
sed -i "s/^SESSION_SECRET_KEY=.*/SESSION_SECRET_KEY=$(python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())")/" backend/.env
docker build -f backend/Dockerfile -t quoll .
docker compose -f backend/docker-compose.yml up -d
```
также рекомендуется закрыть порты: 5432, 8081, 3900 для увеличения безопасности.
