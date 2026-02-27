FROM nginx:alpine
COPY books-table.html /usr/share/nginx/html/index.html
EXPOSE 80
