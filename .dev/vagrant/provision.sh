#!/bin/bash

echo "Provisioning development environment for Pterodactyl Panel."
cp /srv/daemon/.dev/vagrant/motd.txt /etc/motd

echo "Install docker"
curl -sSL https://get.docker.com/ | sh > /dev/null
systemctl enable docker

echo "Install nodejs"
curl -sL https://deb.nodesource.com/setup_6.x | sudo -E bash - > /dev/null
apt-get -y install nodejs > /dev/null

echo "Install additional dependencies"
apt-get -y install tar unzip make gcc g++ python > /dev/null

echo "   ------------"
echo "Provisioning is completed."
echo "You'll still need to configure your node in the panel manually."
echo "See https://daemon.pterodactyl.io/docs/configuration for instructions."
