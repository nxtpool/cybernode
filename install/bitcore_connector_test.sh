cd ../connectors/bitcore
docker stop bitcore_connector
docker rm -v bitcore_connector
docker rmi -f bitcore_connector
docker build -f Dockerfile.test -t bitcore_connector .
docker run -d --net host --name bitcore_connector bitcore_connector
docker attach --sig-proxy=false bitcore_connector
